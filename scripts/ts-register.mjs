// DES-ENGINE-002: registers `ts-hooks.mjs` (see there) before a script runs.
import { register } from 'node:module'

register(new URL('./ts-hooks.mjs', import.meta.url))
