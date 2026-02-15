import { put, select, take } from 'redux-saga/effects'
import { BulletRecord, BulletType, State, TankRecord } from '../types'
import * as actions from '../utils/actions'
import { A } from '../utils/actions'
import {
  calculateBulletStartPosition,
  calculateLaserEndPosition,
  getLaserPathRect,
  getNextId,
  testCollide,
} from '../utils/common'
import IndexHelper from '../utils/IndexHelper'
import * as selectors from '../utils/selectors'
import values from '../utils/values'

// 创建普通子弹
function createNormalBullet(tank: TankRecord, bulletId: number, playerName: string): BulletRecord {
  const { x, y } = calculateBulletStartPosition(tank)
  return new BulletRecord({
    bulletId,
    direction: tank.direction,
    x,
    y,
    lastX: x,
    lastY: y,
    power: values.bulletPower(tank),
    speed: values.bulletSpeed(tank),
    tankId: tank.tankId,
    side: tank.side,
    playerName,
    bulletType: 'normal' as BulletType,
    laserLength: 0,
    laserDuration: 0,
  })
}

// 创建激光子弹
function resolveLaserLength(state: State, x: number, y: number, direction: Direction, maxLength: number) {
  const laserRect = getLaserPathRect(x, y, direction, maxLength)
  const origin: Point = { x, y }
  const calcDistance = (rect: Rect) => {
    if (direction === 'up') {
      return origin.y - (rect.y + rect.height)
    } else if (direction === 'down') {
      return rect.y - origin.y
    } else if (direction === 'left') {
      return origin.x - (rect.x + rect.width)
    } else {
      return rect.x - origin.x
    }
  }

  let minLength = maxLength
  const { bricks, steels } = state.map

  for (const [index, exists] of bricks.entries()) {
    if (!exists) {
      continue
    }
    const rect = IndexHelper.getRect('brick', index)
    if (testCollide(laserRect, rect)) {
      minLength = Math.min(minLength, calcDistance(rect))
    }
  }

  for (const [index, exists] of steels.entries()) {
    if (!exists) {
      continue
    }
    const rect = IndexHelper.getRect('steel', index)
    if (testCollide(laserRect, rect)) {
      minLength = Math.min(minLength, calcDistance(rect))
    }
  }

  return Math.max(0, minLength)
}

function createLaserBullet(
  tank: TankRecord,
  bulletId: number,
  playerName: string,
  state: State,
): BulletRecord {
  const { x, y } = calculateBulletStartPosition(tank)
  const { length } = calculateLaserEndPosition({ x, y, direction: tank.direction })
  const laserLength = resolveLaserLength(state, x, y, tank.direction, length)
  return new BulletRecord({
    bulletId,
    direction: tank.direction,
    x,
    y,
    lastX: x,
    lastY: y,
    power: values.bulletPower(tank),
    speed: 0, // 激光不移动
    tankId: tank.tankId,
    side: tank.side,
    playerName,
    bulletType: 'laser' as BulletType,
    laserLength,
    laserDuration: 15, // 激光持续15帧（约250ms）
  })
}

export default function* fireController(tankId: TankId, shouldFire: () => boolean) {
  // tank.cooldown用来记录player距离下一次可以发射子弹的时间
  // tank.cooldown大于0的时候玩家不能发射子弹
  // 每个TICK时, cooldown都会相应减少. 坦克发射子弹的时候, cooldown重置为坦克的发射间隔
  // tank.cooldown和bulletLimit共同影响坦克能否发射子弹
  while (true) {
    const { delta }: actions.Tick = yield take(A.Tick)
    const state: State = yield select()
    const { bullets: allBullets, game } = state
    const tank: TankRecord = state.tanks.get(tankId)
    if (tank == null || !tank.alive || (tank.side === 'bot' && game.botFrozenTimeout > 0)) {
      continue
    }
    let nextCooldown = tank.cooldown <= 0 ? 0 : tank.cooldown - delta

    if (tank.cooldown <= 0 && shouldFire()) {
      const bullets = allBullets.filter(bullet => bullet.tankId === tank.tankId)
      if (bullets.count() < values.bulletLimit(tank)) {
        const playerName = yield select(selectors.playerName, tankId)
        const bulletId = getNextId('bullet')

        // 当前仅玩家使用激光，bot 保持原有普通子弹
        const useLaser = tank.side === 'player'

        if (tank.side === 'player') {
          yield put(actions.playSound('bullet_shot'))
        }

        const bullet = useLaser
          ? createLaserBullet(tank, bulletId, playerName, state)
          : createNormalBullet(tank, bulletId, playerName)

        yield put(actions.addBullet(bullet))
        // 一旦发射子弹, 则重置cooldown计数器
        nextCooldown = values.bulletInterval(tank)
      } // else 如果坦克发射的子弹已经到达上限, 则坦克不能继续发射子弹
    }

    if (tank.cooldown !== nextCooldown) {
      yield put(actions.setCooldown(tank.tankId, nextCooldown))
    }
  }
}
