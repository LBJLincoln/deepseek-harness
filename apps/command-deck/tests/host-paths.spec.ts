/**
 * The host-path scrub the feed's fold and the deck's fixture snapshot apply
 * before a run's text is published (`deck/host-paths.ts`).
 */
import { describe, expect, it } from 'vitest'
import { hostlessJson, hostlessText } from '../deck/host-paths.ts'

describe('hostlessText', () => {
  it('names what each host directory was and keeps the rest of the path', () => {
    expect(hostlessText('/tmp/claude-0/-home-user-deepseek-harness/f53f80cc-1f77/scratchpad/cs-wrapper/repo/REPORTING.md'))
      .toBe('<scratchpad>/cs-wrapper/repo/REPORTING.md')
    expect(hostlessText('/home/user/deepseek-harness/.code-safety/NodeGoat-2026-09-19T20-49-35/app/server.js'))
      .toBe('<repo>/.code-safety/NodeGoat-2026-09-19T20-49-35/app/server.js')
    expect(hostlessText('/home/user/deepseek-harness/.claude/worktrees/agent-a1/packages/core/a.ts')).toBe('<repo>/packages/core/a.ts')
    expect(hostlessText('cd /home/user/targets/NodeGoat && ls /root/targets/dvja')).toBe('cd <targets>/NodeGoat && ls <targets>/dvja')
    expect(hostlessText('cat /root/.dsh/config and /home/user/enterprise-cycles/c.log')).toBe('cat <home>/.dsh/config and <home>/enterprise-cycles/c.log')
  })

  it('strips a host prefix a length cap cut short', () => {
    expect(hostlessText('grep x /home/user/deepseek-harnes')).toBe('grep x <home>/deepseek-harnes')
    expect(hostlessText('see /tmp/claude-0/-tmp-claude-0--home-user-deepseek-harness-f53f80cc-1f77-5d0')).toBe('see <tmp>')
  })

  it('finds a path right after a JSON escape, and leaves paths that only contain a host name alone', () => {
    expect(hostlessText(String.raw`"exit 0\n/home/user/targets/NodeGoat"`)).toBe(String.raw`"exit 0\n<targets>/NodeGoat"`)
    expect(hostlessText('data/root/x /home/username /opt/node22/bin')).toBe('data/root/x /home/username /opt/node22/bin')
  })
})

describe('hostlessJson', () => {
  it('scrubs every string and key of a payload and leaves other values as they are', () => {
    const review = { target: { path: '/home/user/targets/NodeGoat', files: 111 }, notes: ['/home/user/x'], ['/root/k']: true, verified: null }
    expect(hostlessJson(review)).toEqual({ target: { path: '<targets>/NodeGoat', files: 111 }, notes: ['<home>/x'], ['<home>/k']: true, verified: null })
  })
})
