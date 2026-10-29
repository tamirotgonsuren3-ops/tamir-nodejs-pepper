import './style.css'
import App from './App.svelte'
import { runPgliteMigration } from './db/migrate'

// Pull any data left in the old browser database into the Go store before the
// UI reads from it. Fire-and-forget: the store is empty-safe, and this becomes a
// no-op as soon as it has run once.
void runPgliteMigration()

const app = new App({
  target: document.getElementById('app')
})

export default app
