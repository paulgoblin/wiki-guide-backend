'use strict';

const mongoose   = require('mongoose')
    , jwt        = require('jwt-simple')
    , bcrypt     = require('bcryptjs')
    , moment     = require('moment')
    , CONFIG     = require('../util/auth-config')
    , CONST      = require('../util/constants')
    , Resource   = require('./resource')
    , api_key    = process.env.MAILGUN_KEY
    , domain     = process.env.MAILGUN_DOMAIN
    , jwt_secret = process.env.JWT_SECRET
    , mailgun    = require('mailgun-js')({apiKey: api_key, domain: domain});

let User;

let userSchema = mongoose.Schema({
  username: {type: String, required: true, unique: true},
  password: {type: String, required: true, select: false},
  email: {type: String, select: false},
  likes: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Resource' }],
    default: [],
  },
  strikes: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Resource' }],
    default: [],
  },
});

userSchema.statics.likeResource = function(resourceId, userId, cb) {
  let updateUser = new Promise( (resolve, reject) => {
    User.findByIdAndUpdate(resourceId
      , { $addToSet: {"likes": resourceId } }
      , (err) => {
        if (err) return reject(err);
        resolve();
    })
  })
  let updateResource = new Promise( (resolve, reject) => {
    Resource.findByIdAndUpdate(resourceId
      , { $inc: {"likes": 1 } }
      , (err) => {
        if (err) return reject(err);
        resolve();
    })
  })

  Promise.all([updateUser, updateResource]).then( (value) => {
    cb(null, "success")
  }, (err) => {
    console.log("error liking resource", resourceId, userId, err);
    cb(err)
  })
}

userSchema.statics.strikeResource = function(resourceId, userId, cb) {
  let updateUser = new Promise( (resolve, reject) => {
    User.findByIdAndUpdate(resourceId
      , { $addToSet: {"strikes": resourceId } }
      , (err) => {
        if (err) return reject(err);
        resolve();
    })
  })
  let updateResource = new Promise( (resolve, reject) => {
    Resource.findByIdAndUpdate(resourceId
      , { $inc: {"strikes": 1 } }
      , (err) => {
        if (err) return reject(err);
        resolve();
    })
  })

  Promise.all([updateUser, updateResource]).then( (value) => {
    cb(null, "success")
  }, (err) => {
    console.log("error striking resource", resourceId, userId, err);
    cb(err)
  })
}

userSchema.methods.token = function() {
  let payload = {
    id: this._id,
    iat: moment().unix(),
    exp: moment().add(CONFIG.expTime.num, CONFIG.expTime.unit).unix(),
    username: this.username,
  };
  return jwt.encode(payload, jwt_secret);
};


userSchema.statics.login = function(userInfo, cb) {
  // look for user in database
  User.findOne({username: userInfo.username})
    .select('+password')
    .exec((err, foundUser) => {
    if (err) return cb('Server Error');
    if (!foundUser) return cb('Incorrect username or password.');
    bcrypt.compare(userInfo.password, foundUser.password, (err, isGood) => {
      if (err) return cb('Server Error');
      if (isGood) {
        let token = foundUser.token()
        foundUser = foundUser.toObject();
        delete foundUser.password;
        console.log("Returning saved user", foundUser);
        return cb(err, token );
      } else {
        return cb('Incorrect username or password.');
      }
    });
  });
}


userSchema.statics.register = function(userInfo, cb) {
  let username  = userInfo.username
    , email     = userInfo.email
    , password  = userInfo.password
    , password2 = userInfo.password2;

  // compare passwords
  if (password !== password2) {
    return cb("Passwords do not match.");
  }

  // validate password
  if (!CONFIG.validatePassword(password)) {
    return cb('Invalid password.');
  }

  // validate username
  if (!CONFIG.validateUsername(username)) {
    return cb('Invalid username.');
  }

  // create user model
  let newUserQuery = email ? { $or: [{email: email}, {username: username}] } : {username: username};
  User.findOne(newUserQuery)
    .select('+email')
    .exec((err, user) => {
    if (err) return cb('Error registering username.');
    if (user) {
      if (username === user.username) return cb('Username taken.');
      if (email === user.email) return cb('Email taken.');
    }
    bcrypt.genSalt(CONFIG.saltRounds, (err, salt) => {
      if (err) return cb(err);
      bcrypt.hash(password, salt, (err, hashedPassword) => {
        if (err) return cb(err);
        let newUser = new User({
          username: username,
          email: email,
          password: hashedPassword
        });
        console.log("new USER", newUser);

        newUser.save((err, savedUser) => {
          if(err || !savedUser){
            console.log("error saving new user", err);
            return cb('Username or email already taken.');
          }
          if(savedUser.email){
             let emailData = {
                from: `welcome@${CONST.domainName}`,
                to: savedUser.email,
                subject: `Welcome To ${CONST.projectName}!`,
                text: 'Hello there '+ savedUser.username + `! Congratulations on joining ${CONST.projectName}!\n\n` +
                      `Don't worry, we won't bug you! But if you ever need to, you can resest your password with this email. Tally-ho!\n\n` +
                      `${CONST.frontEndUrl}\n\n`
             };
             mailgun.messages().send(emailData, function (err, body) {
               if (err) console.log("mailgun Error", err);
            });
           }

          let token = savedUser.token()
          savedUser = savedUser.toObject();
          delete savedUser.password;
          console.log("returning saved user", savedUser);
          return cb(err, token);
        })
      });
    });
  });
};

userSchema.statics.getOneAuth = (req, res, cb) => {
  if (req.userId !== req.params.userId) {
    res.status(403);
    return cb('not auhorized', null, res)
  } else {
    User.findById(req.params.userId, (err, user) => {
      if (err || !user) {
        console.log("error at User.getOneAuth", err || 'no user found');
        return cb('error finding a user', null, res.status(400));
      }
      return cb(null, user, res.status(200))
    })
  }
}

 User = mongoose.model('User', userSchema);
 module.exports = User;
