const connectDB = require('./config/db')
const { User, Directory, Post } = require('./models')

const seedUsers = [
  {
    keyId: 'admin',
    password: 'admin123',
    role: 'admin',
    displayName: 'Admin',
    isActive: true,
    subscription: {
      startDate: new Date('2026-01-15'),
      endDate: new Date('2027-01-15'),
      type: 'yearly',
    },
  },
  {
    keyId: 'user001',
    password: 'user001',
    role: 'user',
    isActive: true,
    subscription: {
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-07-01'),
      type: '3months',
    },
  },
  {
    keyId: 'user002',
    password: 'user002',
    role: 'user',
    isActive: true,
    subscription: {
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-06-01'),
      type: 'monthly',
    },
  },
  {
    keyId: 'user003',
    password: 'user003',
    role: 'user',
    isActive: false,
    subscription: {
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      type: 'yearly',
    },
  },
]

const seedDirectories = [
  { name: 'exclusive_collection' },
  { name: 'trending_styles' },
  { name: 'private_premium_pack' },
  { name: 'latest_uploads' },
]

const seedPosts = [
  {
    imageUrl: ['https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&h=600&fit=crop'],
    caption: 'Exclusive premium gallery uploaded today.',
    category: 0,
    directoryName: 'exclusive_collection',
  },
  {
    imageUrl: [
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=600&h=600&fit=crop',
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=600&h=600&fit=crop',
      'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=600&h=600&fit=crop',
    ],
    caption: 'Stunning portraits from our latest curated collection.',
    category: 0,
    directoryName: 'exclusive_collection',
  },
  {
    imageUrl: [
      'https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=600&h=600&fit=crop',
      'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=600&h=600&fit=crop',
    ],
    caption: 'Fresh uploads from top creators.',
    category: 1,
    directoryName: 'trending_styles',
  },
  {
    imageUrl: ['https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&h=600&fit=crop'],
    caption: 'Limited edition collection featuring the best of contemporary photography.',
    category: 1,
    directoryName: 'trending_styles',
  },
  {
    imageUrl: [
      'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=600&h=600&fit=crop',
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=600&h=600&fit=crop',
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&h=600&fit=crop',
      'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=600&h=600&fit=crop',
    ],
    caption: 'New arrivals just dropped! Check out the latest from our featured artists.',
    category: 0,
    directoryName: 'private_premium_pack',
  },
  {
    imageUrl: [
      'https://images.unsplash.com/photo-1524638431109-93d95c968f03?w=600&h=600&fit=crop',
      'https://images.unsplash.com/photo-1521119989659-a83eee488004?w=600&h=600&fit=crop',
    ],
    caption: 'Hand-picked premium content from the most talented creators worldwide.',
    category: 1,
    directoryName: 'latest_uploads',
  },
]

const seed = async () => {
  try {
    await connectDB()

    // Seed users
    console.log('Seeding users...')
    for (const userData of seedUsers) {
      const existing = await User.findOne({ keyId: userData.keyId })
      if (existing) {
        console.log(`  [skip] "${userData.keyId}" already exists`)
      } else {
        const user = await User.create(userData)
        console.log(`  [created] "${userData.keyId}" (referral: ${user.referralCode})`)
      }
    }

    const admin = await User.findOne({ keyId: { $in: ['TGS-AD-01', 'admin'] } })
    const user001 = await User.findOne({ keyId: 'user001' })
    if (admin && user001 && !user001.referredBy) {
      user001.referredBy = admin._id
      await user001.save({ validateBeforeSave: false })
      console.log('  [linked] user001 referred by admin')
    }

    // Seed directories
    console.log('\nSeeding directories...')
    const dirMap = {}
    for (const dirData of seedDirectories) {
      let dir = await Directory.findOne({ name: dirData.name })
      if (dir) {
        console.log(`  [skip] "${dirData.name}" already exists`)
      } else {
        dir = await Directory.create(dirData)
        console.log(`  [created] "${dirData.name}"`)
      }
      dirMap[dirData.name] = dir._id
    }

    // Seed posts
    console.log('\nSeeding posts...')
    const existingPostCount = await Post.countDocuments()
    if (existingPostCount > 0) {
      console.log(`  [skip] ${existingPostCount} posts already exist`)
    } else {
      for (const postData of seedPosts) {
        const { directoryName, ...rest } = postData
        await Post.create({
          ...rest,
          directory: dirMap[directoryName],
        })
        console.log(`  [created] post in "${directoryName}" (${rest.imageUrl.length} image${rest.imageUrl.length > 1 ? 's' : ''})`)
      }

      // Update directory totalPictures counts
      for (const [name, dirId] of Object.entries(dirMap)) {
        const count = await Post.countDocuments({ directory: dirId, deletedAt: null })
        await Directory.findByIdAndUpdate(dirId, { totalPictures: count })
      }
      console.log('  [updated] directory picture counts')
    }

    console.log('\nSeed completed.')
    process.exit(0)
  } catch (error) {
    console.error('Seed failed:', error.message)
    process.exit(1)
  }
}

seed()
