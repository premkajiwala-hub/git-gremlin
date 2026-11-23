/** This PC's addresses on the local network (Wi-Fi first), for opening its sites on a phone. */
import { networkInterfaces } from 'node:os'

const VIRTUAL = /vethernet|wsl|hyper-v|virtualbox|vmware|docker|loopback|bluetooth|tailscale|zerotier|npcap|vpn|tap-|tun/i

/** This PC's addresses on the local network, the likeliest (Wi-Fi, then Ethernet) first. */
export function lanAddresses(): { name: string; address: string }[] {
  const out: { name: string; address: string; score: number }[] = []
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue
      if (VIRTUAL.test(name)) continue
      const priv = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)
      const score = (/wi-?fi|wlan|wireless/i.test(name) ? 4 : /ethernet|^eth/i.test(name) ? 2 : 0) + (priv ? 1 : 0)
      out.push({ name, address: a.address, score })
    }
  }
  return out.sort((x, y) => y.score - x.score).map(({ name, address }) => ({ name, address }))
}
