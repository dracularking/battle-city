import { Record } from 'immutable'

export type BulletType = 'normal' | 'laser'

const BulletRecordBase = Record({
  bulletId: 0 as BulletId,
  // 子弹的方向
  direction: 'up' as Direction,
  // 子弹的速度
  speed: 0,
  // 子弹的位置
  x: 0,
  y: 0,
  // 子弹上一次的位置
  lastX: 0,
  lastY: 0,
  /**
   * 子弹的强度 默认强度为1
   * 强度大于等于2的子弹一下子可以破坏两倍的brick-wall
   * 强度为3的子弹可以破坏steel-wall */
  power: 1,
  // 发射子弹的坦克id
  tankId: -1 as TankId,
  side: 'player' as Side,
  // 发射子弹的玩家
  playerName: null as PlayerName,
  // 子弹类型: normal(普通子弹) | laser(激光)
  bulletType: 'normal' as BulletType,
  // 激光长度(仅激光类型使用)
  laserLength: 0,
  // 激光持续时间(帧数)
  laserDuration: 0,
})

export default class BulletRecord extends BulletRecordBase {
  static fromJS(object: any) {
    return new BulletRecord(object)
  }
}
