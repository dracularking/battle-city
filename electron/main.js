const { app, BrowserWindow, Menu } = require('electron')
const path = require('path')

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 816,
    height: 639,
    minWidth: 816,
    minHeight: 639,
    title: '坦克大战 - Battle City',
    icon: path.join(__dirname, '../resources/icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
    useContentSize: true,
  })

  mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))

  mainWindow.on('closed', () => {
    // 窗口关闭时不需要手动设为 null，Electron 会自动处理
  })
}

const template = [
  {
    label: '游戏',
    submenu: [
      { role: 'reload', label: '重新开始' },
      { role: 'togglefullscreen', label: '全屏' },
      { type: 'separator' },
      { role: 'quit', label: '退出' },
    ],
  },
  {
    label: '帮助',
    submenu: [
      {
        label: '关于',
        click: async () => {
          const { dialog } = require('electron')
          dialog.showMessageBox({
            type: 'info',
            title: '关于坦克大战',
            message: '坦克大战复刻版',
            detail: '基于 React 开发的经典坦克大战游戏\n\n操作说明：\n玩家1: WASD 移动, J 射击\n玩家2: 方向键移动, Num1 射击',
          })
        },
      },
    ],
  },
]

const menu = Menu.buildFromTemplate(template)
Menu.setApplicationMenu(menu)

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
