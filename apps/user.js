import { common, plugin, segment } from '#Karin'
import { MysApi, MysUtil } from '#Mys.api'
import { Player } from '#Mys.profile'
import { Base } from '#Mys.tool'
import { MysUser, User } from '#Mys.user'
import _ from 'lodash'
import QR from 'qrcode'

const QRCodes = {}
const reg = Object.values(MysUtil.reg).join('|')
export class UserBing extends plugin {
  constructor () {
    super({
      name: '用户绑定',
      dsc: '米游社ck绑定，游戏uid绑定',
      event: 'message',
      priority: 300,
      rule: [
        {
          reg: /ltoken|ltoken_v2|ltuid|login_uid|ltmid_v2|stoken|stuid/,
          fnc: 'bing'
        },
        {
          reg: new RegExp(`^#?(${reg})?绑定(uid)?$`, 'i'),
          fnc: 'bing'
        },
        {
          reg: '^#(扫码|二维码|辅助)(登录|绑定|登陆)$',
          fnc: 'miHoYoLoginQRCode'
        },
        {
          reg: '^#?(刷新|更新)c(oo)?k(ie)?$',
          fnc: 'updateCK'
        },
        {
          reg: /^#绑定(c(oo)?k(ie)?|s(to)?k(en)?)$/i,
          fnc: 'bingCk_SK'
        },
        {
          reg: new RegExp(`^#?(${reg})?我的(c(oo)?k(ie)?|s(to)?k(en)?)$`, 'i'),
          fnc: 'myCk_Sk'
        },
        {
          reg: new RegExp(`^#?(${reg})?删除(c(oo)?k(ie)?|s(to)?k(en)?)(\\s|\\+)*([0-9]{1,2})?$`, 'i'),
          fnc: 'delCk_Sk'
        },
        {
          reg: new RegExp(`^#?(${reg})?绑定(uid)?(\\s|\\+)*((18|[1-9])[0-9]{8})?$`, 'i'),
          fnc: 'bingUid'
        },
        {
          reg: new RegExp(`^#?(${reg})?(删除|解绑)uid(\\s|\\+)*([0-9]{1,2})?$`, 'i'),
          fnc: 'delUid'
        },
        {
          reg: new RegExp(`^#?(${reg})?(我的)?uid$`, 'i'),
          fnc: 'showUid'
        },
        {
          reg: new RegExp(`^#?(${reg})?(我的)?uid[0-9]{0,2}$`, 'i'),
          fnc: 'setMainUid'
        }
      ]
    })
  }

  /** 获取当前user实例 */
  async user () {
    return await User.create(this.e, MysUtil.getGameByMsg(this.e.msg).key)
  }

  async bing () {
    // 由于手机端米游社网页可能获取不到ltuid 可以尝试在通行证页面获取login_uid
    if (/(ltoken|ltoken_v2)/.test(this.e.msg) && /(ltuid|login_uid|ltmid_v2)/.test(this.e.msg)) {
      if (this.e.isGroup) {
        return this.reply('请私聊发送Cookie', { at: true })
      }
      await this.bingCk(this.e.msg)
      return true
    }

    if (/stoken/.test(this.e.msg) && /stuid/.test(this.e.msg)) {
      if (this.e.isGroup) {
        return this.reply('请私聊发送Stoken', { at: true })
      }
      await this.bingSk(this.e.msg)
      return true
    }

    if (new RegExp(`^(${MysUtil.reg.sr})?绑定(uid)?$`, 'i').test(this.e.msg)) {
      this.setContext('saveUid')
      this.reply('请发送需要绑定的原神uid', { at: true })
      return true
    }

    if ((new RegExp(`^${MysUtil.reg.sr}绑定(uid)?$`, 'i')).test(this.e.msg)) {
      this.setContext('saveSrUid')
      this.reply('请发送需要绑定的星铁uid', { at: true })
      return true
    }

    return false
  }

  /** 扫码登录 */
  async miHoYoLoginQRCode () {
    if (QRCodes[this.e.user_id]) {
      this.reply([
        segment.text('请使用米游社扫码登录'), QRCodes[this.e.user_id]
      ], { at: true, recallMsg: 60 })
      return true
    }

    QRCodes[this.e.user_id] = true

    const device = MysUtil.randomString(64)
    const mysApi = new MysApi({ user_id: this.e.user_id })

    const QRcode = await mysApi.getData('fetchQRcode', { device })

    const url = QRcode?.data?.url
    if (!url) {
      delete QRCodes[this.e.user_id]
      this.reply('获取二维码失败、请稍后再试', { at: true })
      return true
    }
    const ticket = url.split('ticket=')[1]
    const img = segment.image((await QR.toDataURL(url)).replace('data:image/png;base64,', 'base64://'))
    QRCodes[this.e.user_id] = img
    this.reply([segment.text('请使用米游社扫码登录'), img], { at: true, recallMsg: 60 })

    let data
    let Scanned
    for (let n = 1; n < 60; n++) {
      await common.sleep(5000)
      try {
        const res = await mysApi.getData('queryQRcode', { device, ticket })

        if (res.retcode != 0) {
          this.reply('二维码已过期，请重新登录', { at: true, recallMsg: 60 })
          delete QRCodes[this.e.user_id]
          return true
        }

        if (res.data.stat == 'Scanned' && !Scanned) {
          Scanned = true
          this.reply('二维码已扫描，请确认登录', { at: true, recallMsg: 60 })
        }

        if (res.data.stat == 'Confirmed') {
          data = JSON.parse(res.data.payload.raw)
          break
        }
      } catch (err) {
        logger.error(`[扫码登录] 错误：${logger.red(err)}`)
      }
    }

    if (!(data.uid && data.token)) {
      this.reply('登录失败', { at: true })
      delete QRCodes[this.e.user_id]
      return false
    }

    const res = await mysApi.getData('getTokenByGameToken', data)
    const stoken = `stoken=${res.data.token.token};stuid=${res.data.user_info.aid};mid=${res.data.user_info.mid};`

    await this.bingSk(stoken)
    delete QRCodes[this.e.user_id]
    return true
  }

  /** 绑定uid */
  async bingUid (game) {
    const uid = MysUtil.matchUid(this.e.msg)
    if (typeof game !== 'string') {
      game = MysUtil.getGameByMsg(this.e.msg)
    } else {
      game = MysUtil.getGame(game)
    }
    if (!uid) {
      this.reply(`${game.name}UID输入错误`, { at: true })
      return
    }

    const user = await this.user()
    user.addRegUid(uid, game.key)
    return await this.showUid()
  }

  /** 解绑uid */
  async delUid () {
    const idx = this.e.msg.match(/[0-9]{1,2}/g)
    if (idx && idx[0]) {
      const user = await this.user()

      const uidList = user.getUidList()
      if (idx[0] > uidList.length) {
        return this.reply('uid序号输入错误')
      }

      user.delRegUid(uidList[Number(idx[0]) - 1])
      return await this.showUid()
    } else {
      this.reply('删除uid请带上序号\n例如：#删除uid1\n发送【#uid】可查看绑定的uid以及对应的序号')
      return true
    }
  }

  /** 绑定原神uid */
  async saveUid () {
    if (!this.e.msg) return

    await this.bingUid(MysUtil.getGame('gs'))
    this.finish('saveUid')
  }

  /** 绑定星铁uid */
  async saveSrUid () {
    if (!this.e.msg) return

    await this.bingUid(MysUtil.getGame('sr'))
    this.finish('saveSrUid')
  }

  /** 查看切换uid */
  async showUid () {
    const base = new Base(this.e, 'uid')
    base.model = 'user/uid-list'

    const user = await this.user()
    const uids = [...MysUtil.games]

    _.forEach(uids, (ds) => {
      const uidList = user.getUidList(ds.key, true)
      ds.uidList = uidList.list
      ds.banList = uidList.ban
      _.forEach(ds.uidList, (uidDs) => {
        const player = new Player(uidDs.uid, ds.key)
        uidDs.name = player.name
        uidDs.level = player.level
        const imgs = base.getBannerFaceImg(ds.key, 'common')
        // todo 优化face、banner
        uidDs.face = player.face || imgs.face
        uidDs.banner = imgs.banner
      })
    })

    return this.reply(await base.renderImg({ uids }))
  }

  /** 切换UID */
  async setMainUid () {
    const idx = this.e.msg.match(/[0-9]{1,2}/g)

    const user = await this.user()
    const game = MysUtil.getGameByMsg(this.e.msg)

    const uidList = user.getUidList(game.key)
    if (idx[0] > uidList.length) {
      return this.reply(`${game.name}uid序号输入错误`)
    }
    user.setMainUid(uidList[Number(idx[0]) - 1], game.key)
    return await this.showUid()
  }

  /** 绑定ck、sk */
  bingCk_SK () {
    return this.reply('请直接发送cookie、stoken或使用#扫码登录')
  }

  /** 删除UID与CK或SK的绑定 */
  async delCk_Sk () {
    const idx = this.e.msg.match(/[0-9]{1,2}/g)

    const user = await this.user()
    let uid = user.mainUid()

    if (idx && idx[0]) {
      const uidList = user.getUidList()
      if (idx[0] > uidList.length) {
        return this.reply('序号输入错误')
      }
      uid = uidList[Number(idx[0]) - 1]
    }

    const isCK = MysUtil.isCk(this.e.msg)
    if (!uid) {
      this.reply('暂未绑定UID', { at: true })
      return
    }
    if (!(user.getUidData({ uid }))[isCK ? 'ck' : 'sk']) {
      this.reply(`UID:${uid}暂未绑定${isCK ? 'CK' : 'SK'}`, { at: true })
      return
    }
    user.setUidType({ deluid: uid, delck: isCK })

    this.reply(`已删除UID:${uid}绑定的${isCK ? 'CK' : 'SK'}`, { at: true })
  }

  /** 查询当前UID的CK或SK */
  async myCk_Sk () {
    if (this.e.isGroup) {
      return this.reply('请私聊查看', { at: true })
    }
    const user = await this.user()
    const data = user.getUidData()
    const msg = [`${MysUtil.getGameByMsg(this.e.msg).name}UID: ${data?.uid || user.mainUid()}`]
    if (!data) {
      return this.reply(msg[0] + '，未绑定CK及SK')
    }

    if (MysUtil.isCk(this.e.msg)) {
      msg.push(data.ck ? ('\n' + data.ck) : '，未绑定CK')
    } else {
      msg.push(data.sk ? ('\n' + data.sk) : '，未绑定SK')
    }
    return this.reply(msg.join(''))
  }

  /** 绑定Stoken */
  async bingSk (stoken = '') {
    const user = await this.user()
    if (!stoken && !this.e.sk) {
      return this.reply('请发送#扫码登录')
    }

    const param = MysUtil.getCookieMap(stoken || this.e.sk)

    if (!param.stoken || !param.stuid || !(param.ltoken || param.mid)) {
      return this.reply('发送Stoken不完整\n请使用#扫码登录')
    }
    if (!param.stuid) return this.reply('发送stoken不完整或数据错误')

    const mys = await MysUser.create(param.stuid)

    param._stoken = {
      stoken: param.stoken,
      stuid: param.stuid,
      ltoken: param.ltoken || '',
      mid: param.mid || ''
    }

    await mys.setCkData(param)
    const cookie = await mys.updataCookie()
    if (!cookie) {
      return this.reply('绑定Stoken失败，请#扫码登录')
    }
    const sendMsg = []
    this._reply = this.reply
    this.reply = (msg) => sendMsg.push(msg)

    await this.bingCk(cookie, user, mys, 'all')
    logger.mark(`${this.e.logFnc} 保存Stoken成功 [stuid:${mys.ltuid}]`)

    sendMsg.unshift('绑定Stoken成功', `米游社ID：${param.stuid}`)
    return this._reply(sendMsg.join('\n'))
  }

  /**
   * 绑定Cookie
   * @param {User} user
   * @param {MysUser} mys
  */
  async bingCk (cookie = '', user = '', mys = '', type = 'ck') {
    if (!user) user = await this.user()
    if (!cookie && !this.e.ck) {
      return this.reply('请发送#扫码登录')
    }

    const param = MysUtil.getCookieMap(cookie || this.e.ck)

    if (!param.cookie_token && !param.cookie_token_v2) {
      return this.reply('发送Cookie不完整\n请使用#扫码登录')
    }

    const data = {
      ltoken: param.ltoken,
      login_ticket: param.login_ticket ?? '',
      ltuid: param.ltuid || param.login_uid || param.ltuid_v2 || param.account_id_v2 || param.ltmid_v2
    }
    data._cookie = {
      ltoken: param.ltoken,
      ltuid: data.ltuid,
      cookie_token: param.cookie_token || param.cookie_token_v2,
      account_id: data.ltuid
    }
    if (!data.ltuid) return this.reply('发送Cookie不完整或数据错误')

    if (!mys) mys = await MysUser.create(data.ltuid)

    let flagV2 = false

    if (param.cookie_token_v2 && (param.account_mid_v2 || param.ltmid_v2)) { //
      // account_mid_v2 为版本必须带的字段，不带的话会一直提示绑定cookie失败 请重新登录
      flagV2 = true
      data._cookie = {
        ltuid: data.ltuid,
        account_mid_v2: param.account_mid_v2,
        cookie_token_v2: param.cookie_token_v2,
        ltoken_v2: param.ltoken_v2,
        ltmid_v2: param.ltmid_v2
      }
    }

    if (param.mi18nLang) {
      data._cookie.mi18nLang = param.mi18nLang
    }

    mys.setCkData(data)

    /** 检查ck是否失效 */
    const uidRet = await mys.reqMysUid()
    if (uidRet.status !== 0) {
      logger.mark(`绑定Cookie错误1：${uidRet.msg || 'Cookie错误'}`)
      return this.reply(`绑定Cookie失败：${uidRet.msg || 'Cookie错误'}`)
    }

    // 判断data.ltuid是否是数字
    if (flagV2 && isNaN(data.ltuid)) {
      // 获取米游社通行证id
      const userFullInfo = await mys.getUserFullInfo()
      if (userFullInfo?.data?.user_info) {
        data.ltuid = userFullInfo?.data?.user_info?.uid || data.ltuid
        data._cookie.ltuid = data.ltuid
        mys.setCkData(data)
      } else {
        logger.mark(`绑定Cookie错误2：${userFullInfo.message || 'Cookie错误'}`)
        return this.reply(`绑定Cookie失败：${userFullInfo.message || 'Cookie错误'}`)
      }
    }

    await user.addMysUser(mys, type)
    await mys.save()

    logger.mark(`${this.e.logFnc} 保存Cookie成功 [ltuid:${mys.ltuid}]`)

    let uidMsg = ['绑定Cookie成功', mys.getUidInfo()]
    return this.reply(uidMsg.join('\n'))
  }

  async updateCK () {
    const user = await this.user()

    const sendMsg = []
    this._reply = this.reply
    this.reply = (msg) => sendMsg.push(msg)

    for (const stuid of user.stuids) {
      const mys = user.mysUsers[stuid]
      const ck = await mys.updataCookie()
      if (!ck) {
        this.reply([mys.getUidInfo(), 'stoken已失效，请重新绑定'].join('\n'))
        continue
      }
      await this.bingCk(ck, user, mys, 'all')
    }
    // todo 合并转发
    for (const msg of sendMsg) {
      this._reply(msg)
    }
  }
}
