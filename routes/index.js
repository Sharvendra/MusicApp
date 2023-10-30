var express = require('express');
// const passport = require('passport');
var router = express.Router();
var users = require('../models/userModel')
var songModel = require('../models/songModel');
var playListModel = require('../models/playlistModel');
var passport = require('passport');
var multer = require('multer');
var id3 = require('node-id3');
var crypto = require('crypto');
const { Readable } = require('stream');
var localStrategy = require('passport-local');
passport.use(new localStrategy(users.authenticate()))
const mongoose = require('mongoose');
const userModel = require('../models/userModel');


mongoose.connect('mongodb://0.0.0.0/spt-n').then(() => {
  // console.log("connected");
}).catch(err => {
  console.log(err)
})

const conn = mongoose.connection
var gfsBucket, gfsBUcketPoster
conn.once('open', () => {
  gfsBucket = new mongoose.mongo.GridFSBucket(conn.db, {
    bucketName: 'audio'
  })
  gfsBUcketPoster = new mongoose.mongo.GridFSBucket(conn.db, {
    bucketName: 'poster'
  })
})


/* GET home page. */
router.get('/', isLoggedIn, async function (req, res, next) {
  const currentUser = await userModel.findOne({ _id: req.user._id })
    .populate('playList').populate({
      path: 'playList',
      populate: {
        path: 'songs',
        model: 'song'
      }
    })
  res.render('index', { currentUser });
});

router.get('/poster/:posterName', (req, res, next) => {
  gfsBUcketPoster.openDownloadStreamByName(req.params.posterName).pipe(res)
})

router.post('/register', async (req, res) => {

  var newUser = new users({
    username: req.body.username,
    email: req.body.email,
    contact: req.body.contact
  })
  users.register(newUser, req.body.password)
    .then(function (u) {
      passport.authenticate('local')(req, res, async function () {
        const songs = await songModel.find()
        const defaultList = await playListModel.create({
          name: req.body.username,
          owner: req.user._id,
          songs: songs.map(song => song._id)
        })
        console.log(songs.map(song => song._id))
        const newUser = await userModel.findOne({ _id: req.user._id })
        newUser.playList.push(defaultList._id)
        await newUser.save()

        const currentUser = await userModel.findOne({ _id: req.user._id })
          .populate('playList').populate({
            path: 'playList',
            populate: {
              path: 'songs',
              model: 'song'
            }
          })

        // console.log(JSON.stringify(currentUser))
        res.redirect('/', { currentUser })
      })
    })
    .catch(function (e) {
      res.send(e);
    })
})

router.get('/auth', (req, res) => {
  res.render('register')
})

router.post('/login', passport.authenticate('local', {
  successRedirect: '/',
  failureRedirect: '/auth'
}), function (req, res, next) { });

router.get('/logout', function (req, res, next) {
  req.logout();
  res.redirect('/login');
})

const storage = multer.memoryStorage()
const upload = multer({ storage: storage })
router.post('/uploadMusic', isLoggedIn, isAdmin, upload.array('song'), async (req, res, next) => {
  // console.log(req.file)
  // console.log(id3.read(req.file.buffer))
  await Promise.all(req.files.map(async file => {
    const randomName = crypto.randomBytes(20).toString("hex")
    const songData = id3.read(file.buffer)
    Readable.from(file.buffer).pipe(gfsBucket.openUploadStream(randomName))
    Readable.from(songData.image.imageBuffer).pipe(gfsBUcketPoster.openUploadStream(randomName))
    await songModel.create({
      title: songData.title,
      artist: songData.artist,
      album: songData.album,
      size: file.size,
      poster: randomName + 'poster',
      fileName: randomName
    })
  }))
  // console.log(req.files)
  res.send("songs uploaded")
})

router.get('/uploadmusic', isLoggedIn, isAdmin, (req, res, next) => {
  // console.log(req.user);
  res.render('uploadmusic')
})
router.get('/stream/:musicname', async (req, res, next) => {
  // console.log(req.params.musicname)
  const currentSong =await songModel.findOne({ fileName: req.params.musicname })
  // console.log(currentSong)
  const stream = gfsBucket.openDownloadStreamByName(req.params.musicname)
  res.set('Content-Type','audio/mpeg')
  res.set('Content-Length', currentSong.size )
  res.set('Content-Ranges', 'bytes')
  res.set('Content-Range', `bytes ${0}-${currentSong.size - 1}/${currentSong.size}`)
  res.status(206)
  stream.pipe(res)
})
router.get('/search', (req,res,next)=>{
  res.render('search')
  
})

router.post('/search',async (req,res,next)=>{
  // console.log(req.body.search)
  const searchMusic=await songModel.find({
    title:{$regex: `${req.body.search}`}
  })
  res.json({
    songs:searchMusic
  })
  // console.log(searchMusic)
})

function isLoggedIn(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  else {
    res.redirect('/auth');
  }
}
function isAdmin(req, res, next) {
  if (req.user.isAdmin) return next();
  else return res.redirect('/');
}

module.exports = router;
