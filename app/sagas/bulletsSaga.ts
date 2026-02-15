import { Set as ISet } from 'immutable'
import { all, fork, put, select, take, takeEvery } from 'redux-saga/effects'
import { BulletRecord, BulletsMap, EagleRecord, State, TankRecord } from '../types'
import * as actions from '../utils/actions'
import { A } from '../utils/actions'
import {
  BulletCollisionInfo,
  getCollisionInfoBetweenBullets,
  getMBR,
  lastPos,
  spreadBullet,
} from '../utils/bullet-utils'
import { asRect, DefaultMap, getDirectionInfo, testCollide, getLaserPathRect } from '../utils/common'
import { BULLET_SIZE, FIELD_SIZE, STEEL_POWER } from '../utils/constants'
import IndexHelper from '../utils/IndexHelper'
import { destroyBullets } from './common'

interface Stat {
  /** 坦克被击中的统计 */
  readonly tankHitMap: DefaultMap<TankId, BulletRecord[]>
  readonly bulletCollisionInfo: BulletCollisionInfo
}

interface LaserHitTarget {
  kind: 'brick' | 'steel' | 'tank' | 'eagle' | 'bullet'
  distance: number
  brickT?: BrickIndex
  steelT?: SteelIndex
  tank?: TankRecord
  eagle?: EagleRecord
  bullet?: BulletRecord
}

function getLaserDistanceToRect(origin: Point, direction: Direction, rect: Rect) {
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

function* handleTick() {
  while (true) {
    const { delta }: actions.Tick = yield take(A.Tick)
    const { bullets }: State = yield select()
    if (bullets.isEmpty()) {
      continue
    }
    const updatedBullets = bullets.map(bullet => {
      // 激光子弹不移动，只减少持续时间
      if (bullet.bulletType === 'laser') {
        return bullet.set('laserDuration', bullet.laserDuration - 1)
      }
      // 普通子弹正常移动
      const { direction, speed } = bullet
      const distance = speed * delta
      const { xy, updater } = getDirectionInfo(direction)
      return bullet
        .update(xy, updater(distance))
        .set('lastX', bullet.x)
        .set('lastY', bullet.y) // 设置子弹上一次的位置, 用于进行碰撞检测
    })
    yield put(actions.updateBullets(updatedBullets))
  }
}

function handleBulletsCollidedWithBricks(context: Stat, state: State) {
  // todo 需要考虑子弹强度
  const {
    bullets,
    map: { bricks },
  } = state

  bullets.forEach(b => {
    const mbr = getMBR(asRect(b), asRect(lastPos(b)))
    for (const t of IndexHelper.iter('brick', mbr)) {
      if (bricks.get(t)) {
        context.bulletCollisionInfo.get(b.bulletId).push({ type: 'brick', t })
      }
    }
  })
}

function handleBulletsCollidedWithSteels({ bulletCollisionInfo }: Stat, state: State) {
  // TODO 需要考虑子弹强度
  const {
    bullets,
    map: { steels },
  } = state

  bullets.forEach(b => {
    const mbr = getMBR(asRect(b), asRect(lastPos(b)))
    for (const t of IndexHelper.iter('steel', mbr)) {
      if (steels.get(t)) {
        bulletCollisionInfo.get(b.bulletId).push({ type: 'steel', t })
      }
    }
  })
}

function handleBulletsCollidedWithBorder({ bulletCollisionInfo }: Stat, state: State) {
  const { bullets } = state
  bullets.forEach(bullet => {
    if (bullet.x <= 0) {
      bulletCollisionInfo.get(bullet.bulletId).push({ type: 'border', which: 'left' })
    }
    if (bullet.x + BULLET_SIZE >= FIELD_SIZE) {
      bulletCollisionInfo.get(bullet.bulletId).push({ type: 'border', which: 'right' })
    }
    if (bullet.y <= 0) {
      bulletCollisionInfo.get(bullet.bulletId).push({ type: 'border', which: 'up' })
    }
    if (bullet.y + BULLET_SIZE >= FIELD_SIZE) {
      bulletCollisionInfo.get(bullet.bulletId).push({ type: 'border', which: 'down' })
    }
  })
}

function* destroySteels(collidedBullets: BulletsMap) {
  const {
    map: { steels },
  }: State = yield select()
  const steelsNeedToDestroy: SteelIndex[] = []
  collidedBullets.forEach(bullet => {
    if (bullet.power >= STEEL_POWER) {
      for (const t of IndexHelper.iter('steel', spreadBullet(bullet))) {
        if (steels.get(t)) {
          steelsNeedToDestroy.push(t)
        }
      }
    }
  })

  if (steelsNeedToDestroy.length > 0) {
    yield put(actions.removeSteels(ISet(steelsNeedToDestroy)))
  }
}

function* destroyBricks(collidedBullets: BulletsMap) {
  const {
    map: { bricks },
  }: State = yield select()
  const bricksNeedToDestroy: BrickIndex[] = []

  collidedBullets.forEach(bullet => {
    // TODO spreadBullet的时候 根据bullet.power的不同会影响spread的范围
    for (const t of IndexHelper.iter('brick', spreadBullet(bullet))) {
      if (bricks.get(t)) {
        bricksNeedToDestroy.push(t)
      }
    }
  })

  if (bricksNeedToDestroy.length > 0) {
    yield put(actions.removeBricks(ISet(bricksNeedToDestroy)))
  }
}

function* destroyEagleIfNeeded(expBullets: BulletsMap) {
  const {
    map: { eagle },
  }: State = yield select()
  const eagleBox = asRect(eagle)
  for (const bullet of expBullets.values()) {
    const spreaded = spreadBullet(bullet)
    if (testCollide(eagleBox, spreaded)) {
      yield put(actions.destroyEagle())
      // DESTROY_EAGLE被dispatch之后将会触发游戏失败的流程
      return
    }
  }
}

function handleBulletsCollidedWithTanks(stat: Stat, state: State) {
  const { bullets, tanks: allTanks } = state
  const aliveTanks = allTanks.filter(t => t.alive)

  // 子弹与坦克碰撞的规则
  //        | bullet | tank   | 效果
  // case-1 | player | player | player-tank 将会停滞一段时间
  // case-2 | player | bot    | bot-tank 扣血
  // case-3 | bot    | player | player-tank 扣血/死亡
  // case-4 | bot    | bot    | 无效果，bot-bullet 可以穿过 bot-tank
  for (const bullet of bullets.values()) {
    for (const tank of aliveTanks.values()) {
      if (tank.tankId === bullet.tankId) {
        // 如果是自己发射的子弹, 则不需要进行处理
        continue
      }
      const subject = asRect(tank)
      const mbr = getMBR(asRect(lastPos(bullet)), asRect(bullet))
      if (testCollide(subject, mbr, -0.02)) {
        const bulletSide = bullet.side
        const tankSide = tank.side
        const infoRow = stat.bulletCollisionInfo.get(bullet.bulletId)

        if (bulletSide === 'player') {
          // case-1 或 case-2: 相同的处理
          stat.tankHitMap.get(tank.tankId).push(bullet)
          infoRow.push({ type: 'tank', tank, shouldExplode: true })
        } else if (bulletSide === 'bot' && tankSide === 'player') {
          // case-3
          if (tank.helmetDuration > 0) {
            infoRow.push({ type: 'tank', tank, shouldExplode: false })
          } else {
            stat.tankHitMap.get(tank.tankId).push(bullet)
            infoRow.push({ type: 'tank', tank, shouldExplode: true })
          }
        } // else case-4 子弹穿过坦克，不需要处理
      }
    }
  }
}

function handleBulletsCollidedWithBullets(stat: Stat, state: State, delta: number) {
  const { bullets } = state
  for (const bullet of bullets.values()) {
    for (const other of bullets.values()) {
      if (bullet.bulletId <= other.bulletId) {
        continue
      }
      const collisionInfo = getCollisionInfoBetweenBullets(bullet, other, delta)
      if (collisionInfo) {
        const [info1, info2] = collisionInfo
        stat.bulletCollisionInfo.get(bullet.bulletId).push(info1)
        stat.bulletCollisionInfo.get(other.bulletId).push(info2)
      }
    }
  }
}

function handleBulletsCollidedWithEagle({ bulletCollisionInfo }: Stat, state: State) {
  const {
    bullets,
    map: { eagle },
  } = state
  if (eagle == null || eagle.broken) {
    // 如果Eagle尚未加载, 或是已经被破坏, 那么直接返回
    return
  }
  const eagleBox = asRect(eagle)
  for (const bullet of bullets.values()) {
    const mbr = getMBR(asRect(bullet), asRect(lastPos(bullet)))
    if (testCollide(eagleBox, mbr)) {
      bulletCollisionInfo.get(bullet.bulletId).push({ type: 'eagle', eagle })
    }
  }
}

function* spawnHitActions({ tanks }: State, stat: Stat) {
  for (const [targetTankId, hitBullets] of stat.tankHitMap) {
    // 这里假设一帧内最多只有一发子弹同时击中一架坦克
    const bullet = hitBullets[0]
    const sourceTankId = bullet.tankId
    const targetTank = tanks.get(targetTankId)
    const sourceTank = tanks.get(sourceTankId)
    yield put(actions.hit(bullet, targetTank, sourceTank))
  }
}

// 处理激光子弹的碰撞检测（穿透路径上所有目标）
function handleLaserCollisions(stat: Stat, state: State) {
  const { bullets } = state
  for (const bullet of bullets.values()) {
    if (bullet.bulletType !== 'laser') {
      continue
    }
    
    // 激光持续时间结束，标记为需要移除
    if (bullet.laserDuration <= 0) {
      stat.bulletCollisionInfo.get(bullet.bulletId).push({ type: 'border', which: bullet.direction })
      continue
    }
    
    // 只在激光的第一帧检测碰撞（避免每帧重复添加碰撞）
    if (bullet.laserDuration !== 14) { // 14 是初始值 15 - 1
      continue
    }
    
    const laserRect = getLaserPathRect(bullet.x, bullet.y, bullet.direction, bullet.laserLength)
    const origin: Point = { x: bullet.x, y: bullet.y }
    const targets: LaserHitTarget[] = []

    // 检测与砖块的碰撞
    const { bricks } = state.map
    for (const [index, exists] of bricks.entries()) {
      if (!exists) {
        continue
      }
      const rect = IndexHelper.getRect('brick', index)
      if (testCollide(laserRect, rect)) {
        targets.push({
          kind: 'brick',
          distance: getLaserDistanceToRect(origin, bullet.direction, rect),
          brickT: index,
        })
      }
    }

    // 检测与钢块的碰撞
    const { steels } = state.map
    for (const [index, exists] of steels.entries()) {
      if (!exists) {
        continue
      }
      const rect = IndexHelper.getRect('steel', index)
      if (testCollide(laserRect, rect)) {
        targets.push({
          kind: 'steel',
          distance: getLaserDistanceToRect(origin, bullet.direction, rect),
          steelT: index,
        })
      }
    }

    // 检测与坦克的碰撞
    const aliveTanks = state.tanks.filter(t => t.alive)
    for (const tank of aliveTanks.values()) {
      if (tank.tankId === bullet.tankId) {
        continue
      }
      const rect = asRect(tank)
      if (testCollide(laserRect, rect)) {
        targets.push({
          kind: 'tank',
          distance: getLaserDistanceToRect(origin, bullet.direction, rect),
          tank,
        })
      }
    }

    // 检测与敌方子弹的碰撞（相撞后互相抵消）
    for (const other of bullets.values()) {
      if (other.bulletId === bullet.bulletId || other.side === bullet.side) {
        continue
      }
      const rect = asRect(other)
      if (testCollide(laserRect, rect)) {
        targets.push({
          kind: 'bullet',
          distance: getLaserDistanceToRect(origin, bullet.direction, rect),
          bullet: other,
        })
      }
    }

    // 检测与老鹰的碰撞
    const { eagle } = state.map
    if (eagle && !eagle.broken) {
      const rect = asRect(eagle)
      if (testCollide(laserRect, rect)) {
        targets.push({
          kind: 'eagle',
          distance: getLaserDistanceToRect(origin, bullet.direction, rect),
          eagle,
        })
      }
    }

    if (targets.length === 0) {
      continue
    }

    // 只处理激光前方最近的一层目标，防止穿透
    const minDistance = targets.reduce((min, t) => Math.min(min, t.distance), Infinity)
    const threshold = 0.02
    const frontTargets = targets.filter(t => t.distance - minDistance <= threshold)

    for (const target of frontTargets) {
      if (target.kind === 'brick') {
        stat.bulletCollisionInfo.get(bullet.bulletId).push({ type: 'brick', t: target.brickT })
      } else if (target.kind === 'steel') {
        stat.bulletCollisionInfo.get(bullet.bulletId).push({ type: 'steel', t: target.steelT })
      } else if (target.kind === 'tank') {
        const tank = target.tank
        const shouldExplode =
          bullet.side === 'player' ||
          (bullet.side === 'bot' && tank.side === 'player' && tank.helmetDuration <= 0)
        stat.tankHitMap.get(tank.tankId).push(bullet)
        stat.bulletCollisionInfo.get(bullet.bulletId).push({ type: 'tank', tank, shouldExplode })
      } else if (target.kind === 'bullet') {
        const other = target.bullet
        stat.bulletCollisionInfo.get(bullet.bulletId).push({
          type: 'bullet',
          otherBulletId: other.bulletId,
          x: bullet.x,
          y: bullet.y,
          otherX: other.x,
          otherY: other.y,
        })
        stat.bulletCollisionInfo.get(other.bulletId).push({
          type: 'bullet',
          otherBulletId: bullet.bulletId,
          x: other.x,
          y: other.y,
          otherX: bullet.x,
          otherY: bullet.y,
        })
      } else {
        stat.bulletCollisionInfo.get(bullet.bulletId).push({ type: 'eagle', eagle: target.eagle })
      }
    }
  }
}

function* handleAfterTick() {
  while (true) {
    const { delta }: actions.AfterTick = yield take(A.AfterTick)
    const state: State = yield select()

    // 新建一个统计对象(stat), 用来存放这一个tick中的统计信息
    // 注意这里的Set是ES2015的原生Set
    const stat: Stat = {
      tankHitMap: new DefaultMap(() => []),
      bulletCollisionInfo: new BulletCollisionInfo(state.bullets),
    }

    // 先处理激光子弹的碰撞
    handleLaserCollisions(stat, state)

    handleBulletsCollidedWithEagle(stat, state)
    handleBulletsCollidedWithTanks(stat, state)
    handleBulletsCollidedWithBullets(stat, state, delta)
    handleBulletsCollidedWithBricks(stat, state)
    handleBulletsCollidedWithSteels(stat, state)
    handleBulletsCollidedWithBorder(stat, state)

    const { expBullets, noExpBullets, soundNames } = stat.bulletCollisionInfo.getExplosionInfo()

    // 播放声音
    for (const soundName of soundNames) {
      yield put(actions.playSound(soundName))
    }

    // 产生爆炸效果, 并移除子弹
    yield fork(destroyBullets, expBullets, true)
    // 不产生爆炸, 直接消失的子弹
    yield fork(destroyBullets, noExpBullets, false)

    if (!expBullets.isEmpty()) {
      // 只有产生爆炸效果的子弹才会破坏附近的brickWall/steelWall/eagle
      yield destroyEagleIfNeeded(expBullets)
      yield destroyBricks(expBullets)
      yield destroySteels(expBullets)
    }

    yield spawnHitActions(state, stat)
  }
}

function* clearBullets() {
  yield put(actions.clearBullets())
}

export default function* bulletsSaga() {
  try {
    yield takeEvery(A.EndStage, clearBullets)
    yield all([handleTick(), handleAfterTick()])
  } finally {
    yield clearBullets()
  }
}
