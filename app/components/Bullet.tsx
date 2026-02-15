import React from 'react'
import { BulletRecord } from '../types'
import { getLaserPathRect } from '../utils/common'
import { Pixel } from './elements'

const normalFill = '#ADADAD'
const laserFill = '#FF0000'
const laserGlow = '#FF6666'

const Bullet = ({ bullet }: { bullet: BulletRecord }) => {
  const { direction, x, y, bulletType, laserLength } = bullet

  // 激光子弹渲染
  if (bulletType === 'laser') {
    const isVertical = direction === 'up' || direction === 'down'
    const laserRect = getLaserPathRect(x, y, direction, laserLength)
    const width = laserRect.width
    const height = laserRect.height

    return (
      <g className="bullet laser" transform={`translate(${laserRect.x},${laserRect.y})`}>
        {/* 激光发光效果 */}
        <rect
          width={width + 4}
          height={height + 4}
          x={-2}
          y={-2}
          fill={laserGlow}
          opacity={0.4}
        />
        {/* 激光主体 */}
        <rect width={width} height={height} fill={laserFill} opacity={0.9} />
        {/* 激光核心 */}
        <rect
          width={isVertical ? 1 : width}
          height={isVertical ? height : 1}
          x={isVertical ? 1 : 0}
          y={isVertical ? 0 : 1}
          fill="#FFFFFF"
          opacity={0.8}
        />
      </g>
    )
  }

  // 普通子弹渲染（原有逻辑）
  let head: JSX.Element = null
  if (direction === 'up') {
    head = <Pixel x={1} y={-1} fill={normalFill} />
  } else if (direction === 'down') {
    head = <Pixel x={1} y={3} fill={normalFill} />
  } else if (direction === 'left') {
    head = <Pixel x={-1} y={1} fill={normalFill} />
  } else {
    // right
    head = <Pixel x={3} y={1} fill={normalFill} />
  }
  return (
    <g className="bullet" transform={`translate(${x},${y})`}>
      <rect width={3} height={3} fill={normalFill} />
      {head}
    </g>
  )
}

export default Bullet
