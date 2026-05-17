import { App } from './App.js';
import './styles.scss';

const host = document.getElementById('app');
if (!host) throw new Error('Mount point #app not found.');

new App(host);
