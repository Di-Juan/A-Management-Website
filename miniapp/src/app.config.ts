export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/equipment/index',
    'pages/inventory/index',
    'pages/mine/index',
    'pages/login/index',
    'pages/booking/index',
    'pages/my-bookings/index',
    'pages/activities/index',
    'pages/documents/index',
  ],
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#0f766e',
    navigationBarTitleText: '科协运营',
    navigationBarTextStyle: 'white',
    backgroundColor: '#f3f6f4',
  },
  tabBar: {
    color: '#75857e',
    selectedColor: '#0f766e',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '首页',
        iconPath: 'assets/tabbar/home.png',
        selectedIconPath: 'assets/tabbar/home-active.png',
      },
      {
        pagePath: 'pages/equipment/index',
        text: '设备',
        iconPath: 'assets/tabbar/equipment.png',
        selectedIconPath: 'assets/tabbar/equipment-active.png',
      },
      {
        pagePath: 'pages/inventory/index',
        text: '库存',
        iconPath: 'assets/tabbar/inventory.png',
        selectedIconPath: 'assets/tabbar/inventory-active.png',
      },
      {
        pagePath: 'pages/mine/index',
        text: '我的',
        iconPath: 'assets/tabbar/mine.png',
        selectedIconPath: 'assets/tabbar/mine-active.png',
      },
    ],
  },
});
