import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { LLMClient, Config } from 'coze-coding-dev-sdk';

const CORP_ID = process.env.WECHAT_WORK_CORP_ID || '';
const TOKEN = process.env.WECHAT_WORK_TOKEN || '';
const ENCODING_AES_KEY = process.env.WECHAT_WORK_ENCODING_AES_KEY || '';

// AES解密
function decrypt(encryptedMsg: string): string {
  const aesKey = Buffer.from(ENCODING_AES_KEY + '=', 'base64');
  const encryptedBuffer = Buffer.from(encryptedMsg, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, aesKey.slice(0, 16));
  decipher.setAutoPadding(false);
  let decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
  const pad = decrypted[decrypted.length - 1];
  decrypted = decrypted.slice(0, decrypted.length - pad);
  const content = decrypted.slice(20);
  const xmlEnd = content.lastIndexOf('</xml>');
  return content.slice(0, xmlEnd + 6).toString();
}

// AES加密
function encrypt(xmlContent: string): string {
  const randomString = crypto.randomBytes(16);
  const contentBuffer = Buffer.from(xmlContent);
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(contentBuffer.length, 0);
  const corpIdBuffer = Buffer.from(CORP_ID);
  const textBuffer = Buffer.concat([randomString, lengthBuffer, contentBuffer, corpIdBuffer]);
  const aesKey = Buffer.from(ENCODING_AES_KEY + '=', 'base64');
  const blockSize = 32;
  const padLength = blockSize - (textBuffer.length % blockSize);
  const paddedBuffer = Buffer.concat([textBuffer, Buffer.alloc(padLength, padLength)]);
  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, aesKey.slice(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(paddedBuffer), cipher.final()]).toString('base64');
}

// 解析XML
function parseXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>|<(\w+)>(.*?)<\/\3>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const key = match[1] || match[3];
    const value = match[2] || match[4];
    if (key && value) result[key] = value;
  }
  return result;
}

// 生成签名
function generateSignature(encryptedMsg: string, timestamp: string, nonce: string): string {
  const arr = [TOKEN, timestamp, nonce, encryptedMsg].sort();
  return crypto.createHash('sha1').update(arr.join('')).digest('hex');
}

// URL验证（GET请求）
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const echostr = searchParams.get('echostr') || '';
  try {
    return new NextResponse(decrypt(echostr), { status: 200 });
  } catch {
    return new NextResponse('Error', { status: 500 });
  }
}

// 消息接收（POST请求）
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const timestamp = searchParams.get('timestamp') || '';
    const nonce = searchParams.get('nonce') || '';
    
    const encryptedXml = await request.text();
    const encryptedData = parseXml(encryptedXml);
    const decryptedXml = decrypt(encryptedData.Encrypt);
    const message = parseXml(decryptedXml);

    let replyContent = '';
    
    if (message.MsgType === 'event' && message.Event === 'enter_session') {
      replyContent = '你好～我是这边做学习辅导安排的 😊 可以简单了解一下孩子现在是几年级吗？';
    } else if (message.MsgType === 'text') {
      const config = new Config();
      const client = new LLMClient(config);
      const response = await client.invoke([
        { role: 'system', content: '你是学习辅导客服助手，友善专业，根据年级推荐服务。小学生推伴读30元/时，初中生推补课120元/时。' },
        { role: 'user', content: message.Content },
      ], { model: 'doubao-seed-1-6-flash-250615', temperature: 0.7 });
      replyContent = response.content;
    } else {
      replyContent = '抱歉，我暂时只支持文字消息~';
    }

    const replyXml = `<xml><ToUserName>${message.From}</ToUserName><FromUserName>${message.To}</FromUserName><CreateTime>${Math.floor(Date.now()/1000)}</CreateTime><MsgType>text</MsgType><Content><![CDATA[${replyContent}]]></Content></xml>`;
    const encryptedReply = encrypt(replyXml);
    const signature = generateSignature(encryptedReply, timestamp, nonce);
    const responseXml = `<xml><Encrypt><![CDATA[${encryptedReply}]]></Encrypt><MsgSignature>${signature}</MsgSignature><TimeStamp>${timestamp}</TimeStamp><Nonce>${nonce}</Nonce></xml>`;

    return new NextResponse(responseXml, { status: 200, headers: { 'Content-Type': 'application/xml' } });
  } catch (error) {
    console.error('处理消息错误:', error);
    return new NextResponse('Error', { status: 500 });
  }
}