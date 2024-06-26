import Base from '../Base.js'

export default class ProfileServ extends Base {
  constructor (cfg, game) {
    super(game)
    this._cfg = cfg
  }

  execFn (fn, args = [], def = false) {
    const { _cfg } = this
    if (_cfg[fn]) {
      return _cfg[fn].apply(this, args)
    }
    return def
  }

  updatePlayer (player, data) {
    return this.execFn('updatePlayer', [player, data], {})
  }
}
