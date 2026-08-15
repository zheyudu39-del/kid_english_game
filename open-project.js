// open-project.js - 在浏览器中打开游戏项目
const p = require('puppeteer-core');

(async () => {
  let b;
  try {
    b = await p.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: false,  // 显示浏览器窗口
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized']
    });
    const pg = await b.newPage();
    pg.setViewport({ width: 1280, height: 800 });
    console.log('正在打开游戏主页: http://127.0.0.1:3000/');
    await pg.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded', timeout: 10000 });
    console.log('✅ 游戏主页已加载！');
    console.log('   - 现在可以使用「登录」或「注册」账号');
    console.log('   - 注册后即可开始 666 关闯关（8160 词库）');
    console.log('   - 怪物现在显示为干净的文字卡片（无卡通画面）');
    console.log('');
    console.log('浏览器窗口已打开。关闭此窗口将自动结束。');
  } catch (e) {
    console.log('错误:', e.message);
    if (b) await b.close();
    process.exit(1);
  }
})();