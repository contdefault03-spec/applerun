// Standalone ATMs scattered around commercial buildings (shared/map/layout.js `props.atms`).
// "Check balance" is a pure read of the already-known profile — no server round trip needed.
export class ATMs {
  constructor(game) {
    this.game = game;
    this.list = game.layout.props.atms || [];
  }
  interactions(out, pos) {
    for (const a of this.list) {
      if (Math.hypot(pos.x - a.x, pos.z - a.z) < 1.8) {
        out.push({ label: 'Check balance (ATM)', key: 'interact', priority: 2, action: () => this.game.ui.notify(`Balance: $${this.game.profile.money.toLocaleString()}`, 'info') });
        break;
      }
    }
  }
}
