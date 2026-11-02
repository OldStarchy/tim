import './style.css';
import { Game } from './game';
import * as music from './music';
import { LEVELS } from './levels';
import { decodeScene, loadProgress } from './storage';

const game = new Game(document.getElementById('board') as HTMLCanvasElement);

const hash = new URLSearchParams(location.hash.slice(1));
const shared = hash.get('s');
const levelId = hash.get('level');
const shareScene = shared ? decodeScene(shared) : null;

if (shareScene) {
  game.loadSandbox(shareScene);
  game.toast('Loaded a shared contraption');
} else if (hash.has('sandbox')) {
  game.loadSandbox();
} else {
  const idx = LEVELS.findIndex((l) => l.id === levelId);
  if (idx >= 0) game.loadLevel(idx);
  else {
    const solved = loadProgress();
    const firstUnsolved = LEVELS.findIndex((l) => !solved[l.id]);
    game.loadLevel(firstUnsolved >= 0 ? firstUnsolved : 0);
    game.showMenu();
  }
}

// handy for poking at things from the console
Object.assign(window, { game, music });
