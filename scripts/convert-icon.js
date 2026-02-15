const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

// ICO 文件头
function createIcoHeader(numImages) {
  const buf = Buffer.alloc(6)
  buf.writeUInt16LE(0, 0) // Reserved
  buf.writeUInt16LE(1, 2) // Type: 1 = ICO
  buf.writeUInt16LE(numImages, 4) // Count
  return buf
}

// ICO 图像目录项
function createIcoDirectoryEntry(width, height, size, offset) {
  const buf = Buffer.alloc(16)
  buf.writeUInt8(width === 256 ? 0 : width, 0) // Width
  buf.writeUInt8(height === 256 ? 0 : height, 1) // Height
  buf.writeUInt8(0, 2) // Color palette
  buf.writeUInt8(0, 3) // Reserved
  buf.writeUInt16LE(1, 4) // Color planes
  buf.writeUInt16LE(32, 6) // Bits per pixel
  buf.writeUInt32LE(size, 8) // Size of image data
  buf.writeUInt32LE(offset, 12) // Offset to image data
  return buf
}

// BMP 信息头 (用于 ICO 中的图像数据)
function createBmpInfoHeader(width, height, dataSize) {
  const buf = Buffer.alloc(40)
  buf.writeUInt32LE(40, 0) // Header size
  buf.writeInt32LE(width, 4) // Width
  buf.writeInt32LE(height * 2, 8) // Height (双倍，因为包含 XOR 和 AND 掩码)
  buf.writeUInt16LE(1, 12) // Planes
  buf.writeUInt16LE(32, 14) // Bits per pixel
  buf.writeUInt32LE(0, 16) // Compression (0 = BI_RGB)
  buf.writeUInt32LE(dataSize, 20) // Image size
  buf.writeInt32LE(0, 24) // X pixels per meter
  buf.writeInt32LE(0, 28) // Y pixels per meter
  buf.writeUInt32LE(0, 32) // Colors used
  buf.writeUInt32LE(0, 36) // Important colors
  return buf
}

async function convertToIco() {
  try {
    const inputFile = path.join(__dirname, '../resources/favicon256_original.png')
    const outputFile = path.join(__dirname, '../resources/icon.ico')
    
    // 生成多种尺寸的 PNG 数据
    const sizes = [256, 128, 64, 48, 32, 16]
    const images = []
    
    for (const size of sizes) {
      const pngBuffer = await sharp(inputFile)
        .resize(size, size, { fit: 'cover' })
        .png()
        .toBuffer()
      
      images.push({
        size: size,
        data: pngBuffer
      })
    }
    
    // 构建 ICO 文件
    const numImages = images.length
    const header = createIcoHeader(numImages)
    
    let offset = 6 + (numImages * 16) // 文件头 + 目录
    const directories = []
    const imageDataBuffers = []
    
    for (const img of images) {
      directories.push(createIcoDirectoryEntry(img.size, img.size, img.data.length, offset))
      imageDataBuffers.push(img.data)
      offset += img.data.length
    }
    
    // 合并所有部分
    const icoBuffer = Buffer.concat([
      header,
      ...directories,
      ...imageDataBuffers
    ])
    
    fs.writeFileSync(outputFile, icoBuffer)
    console.log('✅ 图标已生成:', outputFile)
    console.log('包含尺寸:', sizes.join(', '))
  } catch (err) {
    console.error('❌ 转换失败:', err)
    process.exit(1)
  }
}

convertToIco()
