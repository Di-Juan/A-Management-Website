import Taro from '@tarojs/taro';

/** 只有微信小程序端才提供 wx.login */
export const isWechatMiniProgram = process.env.TARO_ENV === 'weapp';

/** 获取 wx.login 的一次性 code，交给服务端换取 openid */
export async function getWechatCode(): Promise<string> {
  if (!isWechatMiniProgram) throw new Error('当前环境不支持微信登录');
  const res = await Taro.login();
  if (!res.code) throw new Error('微信授权失败，请重试');
  return res.code;
}
