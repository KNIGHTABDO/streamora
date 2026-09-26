import { html } from '../../vendor/preact-htm.js';
import { BrowsePage, AnimeArt } from './browse/shelf.js';

export default function Anime({ query }) {
  return html`<${BrowsePage} type="anime" query=${query} header=${AnimeArt} />`;
}
