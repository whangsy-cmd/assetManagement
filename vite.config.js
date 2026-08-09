import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const KIWOOM_BASE = 'https://api.kiwoom.com'
const _tokens = { kr: null, us: null }
const _expiry  = { kr: 0,    us: 0    }

async function getToken(kind, env) {
  if (_tokens[kind] && Date.now() < _expiry[kind]) return _tokens[kind]
  const prefix    = kind === 'kr' ? 'KIWOOM_KR' : 'KIWOOM_US'
  const appkey    = env[`${prefix}_APPKEY`]
  const secretkey = env[`${prefix}_SECRETKEY`]
  if (!appkey || !secretkey) throw new Error(`${prefix}_APPKEY / ${prefix}_SECRETKEY 가 .env에 없습니다`)

  const res  = await fetch(`${KIWOOM_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey, secretkey }),
  })
  const data = await res.json()
  if (!data.token) throw new Error('토큰 발급 실패: ' + JSON.stringify(data))
  _tokens[kind] = data.token
  _expiry[kind]  = Date.now() + 23 * 3600 * 1000
  return _tokens[kind]
}

async function kiwoomCall(kind, apiId, body, env, path = '/api/dostk/acnt') {
  const token = await getToken(kind, env)
  const res   = await fetch(`${KIWOOM_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json;charset=UTF-8',
      'api-id':       apiId,
      'cont-yn':      'N',
      'next-key':     '',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Kiwoom ${res.status} ${await res.text()}`)
  return res.json()
}

function kiwoomPlugin(env) {
  return {
    name: 'kiwoom-proxy',
    configureServer(server) {
      server.middlewares.use('/kiwoom', async (req, res, next) => {
        const url = req.url?.split('?')[0] || '/'

        let body = {}
        if (req.method === 'POST') {
          body = await new Promise((resolve, reject) => {
            const chunks = []
            req.on('data', c => chunks.push(c))
            req.on('end', () => {
              try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}) }
              catch (e) { reject(e) }
            })
            req.on('error', reject)
          })
        }

        const send = (status, data) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(data))
        }

        try {
          if (url === '/health') {
            return send(200, {
              ok: true,
              kr: !!(env.KIWOOM_KR_APPKEY && env.KIWOOM_KR_SECRETKEY),
              us: !!(env.KIWOOM_US_APPKEY && env.KIWOOM_US_SECRETKEY),
            })
          }

          // 국내 보유종목 — kt00018 계좌평가잔고내역
          if (url === '/kr/holdings') {
            const data = await kiwoomCall('kr', 'kt00018', { qry_tp: '0', dmst_stex_tp: 'KRX' }, env)
            return send(200, data)
          }

          // 국내 예수금 — kt00001 예수금상세현황
          if (url === '/kr/cash') {
            const data = await kiwoomCall('kr', 'kt00001', { qry_tp: '0', dmst_stex_tp: 'KRX' }, env)
            return send(200, data)
          }

          next()
        } catch (e) {
          send(500, { error: e.message })
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // '' prefix → VITE_ 필터 없이 .env 전체 로드 (서버 전용 키 포함)
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), kiwoomPlugin(env)],
    define: {
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
  }
})
