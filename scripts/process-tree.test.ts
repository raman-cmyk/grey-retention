import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { it, expect } from 'vitest'
import { stopProcessTree } from './process-tree.mjs'
it('stops a tracked parent and its actual listening server descendant', async () => {
  const serverCode =
    "require('http').createServer((_,r)=>r.end('fixture')).listen(0,'127.0.0.1',function(){process.stdout.write(JSON.stringify({port:this.address().port})+'\\n')})"
  const parentCode = `const {spawn}=require('child_process');spawn(process.execPath,['-e',${JSON.stringify(serverCode)}],{stdio:['ignore','inherit','inherit']});setInterval(()=>{},1000)`
  const child = spawn(process.execPath, ['-e', parentCode], {
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let text = ''
      child.stdout.on('data', (c) => {
        text += String(c)
        if (text.includes('\n')) resolve(JSON.parse(text.split('\n')[0]!).port)
      })
      child.once('error', reject)
    })
    const pids = await stopProcessTree(child.pid!)
    expect(pids.length).toBeGreaterThanOrEqual(2)
    const alive = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => resolve(false))
    })
    expect(alive).toBe(false)
  } finally {
    if (child.pid) await stopProcessTree(child.pid)
  }
}, 10000)
