import { html } from '../../vendor/preact-htm.js';
import { BrowsePage, MovieArt } from './browse/shelf.js';

export default function Movies({ query }) {
  return html`<${BrowsePage} type="movie" query=${query} header=${MovieArt} />`;
}
