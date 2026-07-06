const mongoose = require('mongoose')

const memberKeyCounterSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: 'memberKey',
    },
    seq: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    versionKey: false,
  },
)

const MemberKeyCounter = mongoose.model('MemberKeyCounter', memberKeyCounterSchema)

module.exports = MemberKeyCounter
