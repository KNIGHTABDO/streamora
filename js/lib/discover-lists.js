// Curated lists for the Discover sections. Titles only ("Name|year" or "Name|year|s" for a series);
// meta.js resolveTitles() finds the real items at runtime, so no ids live here.
const L = arr => arr.map(s => { const [name, year, s2] = s.split('|'); return { name, year: +year, type: s2 === 's' ? 'series' : 'movie' }; });

// ---------------------------------------------------------------- moods
export const MOODS = [
  { id: 'cozy', label: 'Cozy', icon: 'sun', color: 'var(--a3)', genres: ['Family', 'Romance'], rx: 'one blanket, warm drink, zero stakes',
    titles: L(['Paddington 2|2017', 'Amélie|2001', 'Chef|2014', 'The Grand Budapest Hotel|2014', 'Little Women|2019', 'My Neighbor Totoro|1988', "Kiki's Delivery Service|1989", "You've Got Mail|1998", 'Julie & Julia|2009', 'About Time|2013', 'The Holiday|2006', 'Fantastic Mr. Fox|2009', 'Moonrise Kingdom|2012', 'Chocolat|2000', 'Stardust|2007', 'Gilmore Girls|2000|s', 'Ted Lasso|2020|s', 'The Great British Bake Off|2010|s']) },
  { id: 'mind', label: 'Mind-Bending', icon: 'sparkle', color: 'var(--a2)', genres: ['Sci-Fi', 'Mystery'], rx: 'take notes. you will need them',
    titles: L(['Inception|2010', 'Memento|2000', 'Primer|2004', 'Predestination|2014', 'Arrival|2016', 'Coherence|2013', 'Tenet|2020', 'Donnie Darko|2001', 'The Prestige|2006', 'Shutter Island|2010', 'Eternal Sunshine of the Spotless Mind|2004', 'Mulholland Drive|2001', 'Enemy|2013', 'Triangle|2009', 'Everything Everywhere All at Once|2022', 'The Matrix|1999', 'Interstellar|2014', 'Dark|2017|s', 'Severance|2022|s']) },
  { id: 'cry', label: 'Cry It Out', icon: 'heart', color: 'var(--a1)', genres: ['Drama', 'Romance'], rx: 'tissues within reach. hydrate after',
    titles: L(['The Notebook|2004', 'Up|2009', 'Coco|2017', 'Grave of the Fireflies|1988', "Hachi: A Dog's Tale|2009", 'A Silent Voice|2016', 'Marley & Me|2008', 'The Green Mile|1999', "Schindler's List|1993", 'Manchester by the Sea|2016', 'Aftersun|2022', 'Life Is Beautiful|1997', 'The Fault in Our Stars|2014', 'Me Before You|2016', 'Past Lives|2023', 'Brokeback Mountain|2005', 'Million Dollar Baby|2004', 'This Is Us|2016|s']) },
  { id: 'adrenaline', label: 'Adrenaline', icon: 'speed', color: 'var(--a1)', genres: ['Action', 'Thriller'], rx: 'volume up. seatbelt on',
    titles: L(['Mad Max: Fury Road|2015', 'John Wick|2014', 'The Raid|2011', 'Top Gun: Maverick|2022', 'Mission: Impossible - Fallout|2018', 'Speed|1994', 'Die Hard|1988', 'Baby Driver|2017', 'Heat|1995', 'The Dark Knight|2008', 'Gladiator|2000', 'Extraction|2020', 'Terminator 2: Judgment Day|1991', 'Ford v Ferrari|2019', 'Kill Bill: Vol. 1|2003', 'Crank|2006', 'Reacher|2022|s', '24|2001|s']) },
  { id: 'comfort', label: 'Comfort Rewatch', icon: 'refresh', color: 'var(--a4)', genres: ['Comedy', 'Family'], rx: 'you know every line. that is the point',
    titles: L(['Friends|1994|s', 'The Office|2005|s', 'Parks and Recreation|2009|s', 'Brooklyn Nine-Nine|2013|s', "Schitt's Creek|2015|s", 'How I Met Your Mother|2005|s', 'The Lord of the Rings: The Fellowship of the Ring|2001', 'Back to the Future|1985', "Harry Potter and the Sorcerer's Stone|2001", 'Ratatouille|2007', 'Shrek|2001', 'Toy Story|1995', "Ferris Bueller's Day Off|1986", 'The Princess Bride|1987', 'Mean Girls|2004', 'Home Alone|1990', 'Legally Blonde|2001', 'Jurassic Park|1993']) },
  { id: 'date', label: 'Date Night', icon: 'heartFill', color: 'var(--a1)', genres: ['Romance', 'Comedy'], rx: 'share the popcorn. hold hands at act three',
    titles: L(['La La Land|2016', 'Crazy, Stupid, Love.|2011', 'Pride & Prejudice|2005', 'Before Sunrise|1995', '(500) Days of Summer|2009', 'Notting Hill|1999', 'Crazy Rich Asians|2018', 'The Proposal|2009', 'When Harry Met Sally...|1989', 'Love Actually|2003', 'Palm Springs|2020', 'Silver Linings Playbook|2012', 'Anyone But You|2023', 'Titanic|1997', 'Pretty Woman|1990', 'Bridgerton|2020|s', 'Normal People|2020|s']) },
  { id: 'weird', label: '3AM Weird', icon: 'moon', color: 'var(--a2)', genres: ['Fantasy', 'Mystery'], rx: 'best watched half awake. do not ask why',
    titles: L(['Eraserhead|1977', 'Being John Malkovich|1999', 'The Lobster|2015', 'Under the Skin|2013', 'Swiss Army Man|2016', 'Sorry to Bother You|2018', 'Mandy|2018', 'Beau Is Afraid|2023', 'Holy Motors|2012', 'Rubber|2010', 'Poor Things|2023', 'Brazil|1985', 'Paprika|2006', 'Nope|2022', 'Dogtooth|2009', 'The Zero Theorem|2013', 'Twin Peaks|1990|s']) },
  { id: 'lol', label: 'Laugh Out Loud', icon: 'mask', color: 'var(--a3)', genres: ['Comedy'], rx: 'three belly laughs, minimum. refills allowed',
    titles: L(['Superbad|2007', 'Step Brothers|2008', 'The Hangover|2009', 'Anchorman: The Legend of Ron Burgundy|2004', 'Bridesmaids|2011', 'What We Do in the Shadows|2014', 'Hot Fuzz|2007', 'Shaun of the Dead|2004', 'The Nice Guys|2016', '21 Jump Street|2012', 'Game Night|2018', 'Monty Python and the Holy Grail|1975', 'Airplane!|1980', 'Tropic Thunder|2008', "It's Always Sunny in Philadelphia|2005|s", 'Arrested Development|2003|s', 'Curb Your Enthusiasm|2000|s']) },
  { id: 'edge', label: 'Edge of Seat', icon: 'eye', color: 'var(--a2)', genres: ['Thriller', 'Crime'], rx: 'bite your nails responsibly',
    titles: L(['Prisoners|2013', 'Se7en|1995', 'Gone Girl|2014', 'Zodiac|2007', 'The Silence of the Lambs|1991', 'No Country for Old Men|2007', 'Sicario|2015', 'Parasite|2019', 'Uncut Gems|2019', 'Nightcrawler|2014', 'Oldboy|2003', 'Memories of Murder|2003', 'Rear Window|1954', 'Buried|2010', 'Breaking Bad|2008|s', 'True Detective|2014|s', 'Mindhunter|2017|s', 'Squid Game|2021|s']) },
  { id: 'feelgood', label: 'Feel-Good', icon: 'sparkle', color: 'var(--a4)', genres: ['Comedy', 'Family'], rx: 'side effects: smiling at strangers',
    titles: L(['The Intouchables|2011', 'Forrest Gump|1994', 'The Secret Life of Walter Mitty|2013', 'Little Miss Sunshine|2006', 'Sing Street|2016', 'CODA|2021', 'Hidden Figures|2016', 'The Pursuit of Happyness|2006', 'School of Rock|2003', 'Mamma Mia!|2008', 'Paddington|2014', 'The Greatest Showman|2017', 'Soul|2020', 'Good Will Hunting|1997', 'Billy Elliot|2000', 'Abbott Elementary|2021|s']) },
  { id: 'epic', label: 'Epic Adventure', icon: 'globe', color: 'var(--a3)', genres: ['Adventure', 'Fantasy'], rx: 'clear the evening. maybe the weekend',
    titles: L(['The Lord of the Rings: The Return of the King|2003', 'Dune|2021', 'Dune: Part Two|2024', 'Lawrence of Arabia|1962', 'Raiders of the Lost Ark|1981', 'Avatar|2009', 'Pirates of the Caribbean: The Curse of the Black Pearl|2003', 'Star Wars: Episode IV - A New Hope|1977', 'The Revenant|2015', 'Life of Pi|2012', 'Kingdom of Heaven|2005', 'Braveheart|1995', 'Princess Mononoke|1997', 'The Last Samurai|2003', 'Indiana Jones and the Last Crusade|1989', 'Game of Thrones|2011|s', 'Shogun|2024|s']) },
  { id: 'spooky', label: 'Spooky', icon: 'eyeOff', color: 'var(--a1)', genres: ['Horror'], rx: 'lights off. or on. we will not judge',
    titles: L(['Hereditary|2018', 'The Conjuring|2013', 'Get Out|2017', 'The Shining|1980', 'It Follows|2014', 'The Babadook|2014', 'A Quiet Place|2018', 'Halloween|1978', 'The Exorcist|1973', 'Midsommar|2019', 'Talk to Me|2022', 'Sinister|2012', 'The Witch|2015', 'Train to Busan|2016', 'Insidious|2010', 'Scream|1996', 'The Haunting of Hill House|2018|s', 'Midnight Mass|2021|s']) },
];

// ---------------------------------------------------------------- world cinema
// x,y on the doodle map (viewBox 1000×520); flag = up to 3 stripe colours (a doodle, not an official flag)
export const COUNTRIES = [
  { id: 'korea', name: 'South Korea', x: 842, y: 188, flag: ['#fff8ea', '#c8473f', '#2b5fb8'], blurb: 'Genre-bending thrillers and razor-sharp social satire.',
    titles: L(['Parasite|2019', 'Oldboy|2003', 'Memories of Murder|2003', 'The Handmaiden|2016', 'Train to Busan|2016', 'Burning|2018', 'Decision to Leave|2022', 'I Saw the Devil|2010', 'The Host|2006', 'Mother|2009', 'A Tale of Two Sisters|2003', 'The Wailing|2016', 'Squid Game|2021|s', 'Crash Landing on You|2019|s', 'Kingdom|2019|s', 'Extraordinary Attorney Woo|2022|s', 'Mr. Sunshine|2018|s']) },
  { id: 'japan', name: 'Japan', x: 884, y: 196, flag: ['#fff8ea', '#c8473f'], blurb: 'Samurai epics, quiet family dramas and giant lizards.',
    titles: L(['Seven Samurai|1954', 'Rashomon|1950', 'Tokyo Story|1953', 'Spirited Away|2001', 'Akira|1988', 'Ikiru|1952', 'Shoplifters|2018', 'Drive My Car|2021', 'Perfect Days|2023', 'Godzilla Minus One|2023', 'Ringu|1998', 'Battle Royale|2000', 'Departures|2008', 'Audition|1999', 'Tampopo|1985', 'Alice in Borderland|2020|s', 'Midnight Diner: Tokyo Stories|2016|s']) },
  { id: 'india', name: 'India', x: 712, y: 262, flag: ['#ff8a3d', '#fff8ea', '#1fb58f'], blurb: 'Songs, spectacle and three-hour emotional rollercoasters.',
    titles: L(['Sholay|1975', 'Lagaan: Once Upon a Time in India|2001', '3 Idiots|2009', 'Dangal|2016', 'Dilwale Dulhania Le Jayenge|1995', 'RRR|2022', 'Baahubali: The Beginning|2015', 'Gangs of Wasseypur|2012', 'Taare Zameen Par|2007', 'Queen|2013', 'Andhadhun|2018', 'Kabhi Khushi Kabhie Gham...|2001', 'Pather Panchali|1955', 'Zindagi Na Milegi Dobara|2011', 'Jawan|2023', 'Sacred Games|2018|s', 'The Family Man|2019|s', 'Delhi Crime|2019|s']) },
  { id: 'nigeria', name: 'Nigeria', x: 505, y: 300, flag: ['#1fb58f', '#fff8ea', '#1fb58f'], blurb: 'Nollywood: big weddings, bigger drama, crime kings.',
    titles: L(['The Wedding Party|2016', 'King of Boys|2018', 'Lionheart|2018', 'October 1|2014', 'The Black Book|2023', 'Half of a Yellow Sun|2013', 'Citation|2020', 'Anikulapo|2022', 'Chief Daddy|2018', 'The Figurine|2009', 'Gangs of Lagos|2023', "Elesin Oba: The King's Horseman|2022", 'Jagun Jagun|2023', 'Blood Sisters|2022|s', 'Shanty Town|2023|s']) },
  { id: 'france', name: 'France', x: 488, y: 160, flag: ['#2b5fb8', '#fff8ea', '#c8473f'], blurb: 'The New Wave, cigarettes and devastating last shots.',
    titles: L(['Amélie|2001', 'La Haine|1995', 'The 400 Blows|1959', 'Breathless|1960', 'Portrait of a Lady on Fire|2019', 'The Intouchables|2011', 'Anatomy of a Fall|2023', 'Léon: The Professional|1994', 'A Prophet|2009', 'Blue Is the Warmest Colour|2013', 'Jules and Jim|1962', 'Titane|2021', 'Le Samouraï|1967', 'Delicatessen|1991', 'Call My Agent!|2015|s', 'Lupin|2021|s', 'The Bureau|2015|s']) },
  { id: 'italy', name: 'Italy', x: 522, y: 176, flag: ['#1fb58f', '#fff8ea', '#c8473f'], blurb: 'Neorealism, spaghetti westerns and la dolce vita.',
    titles: L(['La Dolce Vita|1960', 'Bicycle Thieves|1948', 'Cinema Paradiso|1988', 'Life Is Beautiful|1997', 'The Good, the Bad and the Ugly|1966', 'Once Upon a Time in the West|1968', 'The Great Beauty|2013', 'Call Me by Your Name|2017', 'Suspiria|1977', 'The Conformist|1970', 'Il Postino: The Postman|1994', 'Perfect Strangers|2016', 'Rome, Open City|1945', 'The Hand of God|2021', 'Gomorrah|2014|s', 'My Brilliant Friend|2018|s']) },
  { id: 'spain', name: 'Spain', x: 466, y: 182, flag: ['#c8473f', '#ffd23f', '#c8473f'], blurb: 'Almodóvar colours, elegant ghosts and heist capers.',
    titles: L(["Pan's Labyrinth|2006", 'Volver|2006', 'The Orphanage|2007', '[REC]|2007', 'Talk to Her|2002', 'The Others|2001', 'Open Your Eyes|1997', 'The Platform|2019', 'Society of the Snow|2023', 'All About My Mother|1999', 'The Invisible Guest|2016', 'Timecrimes|2007', 'Pain and Glory|2019', 'The Skin I Live In|2011', 'Money Heist|2017|s', 'Elite|2018|s']) },
  { id: 'mexico', name: 'Mexico', x: 190, y: 250, flag: ['#1fb58f', '#fff8ea', '#c8473f'], blurb: 'Road trips, ghosts and the three amigos of cinema.',
    titles: L(['Roma|2018', 'Y Tu Mamá También|2001', 'Amores Perros|2000', 'Cronos|1993', 'Los Olvidados|1950', 'Like Water for Chocolate|1992', 'Tigers Are Not Afraid|2017', 'New Order|2020', 'Bardo, False Chronicle of a Handful of Truths|2022', 'El Infierno|2010', 'The Crime of Padre Amaro|2002', 'Narcos: Mexico|2018|s', 'Club de Cuervos|2015|s']) },
  { id: 'brazil', name: 'Brazil', x: 318, y: 350, flag: ['#1fb58f', '#ffd23f', '#2b5fb8'], blurb: 'Favela epics, fierce politics and sun-bleached westerns.',
    titles: L(['City of God|2002', 'Central Station|1998', 'Elite Squad|2007', 'Elite Squad: The Enemy Within|2010', 'Bacurau|2019', 'The Second Mother|2015', 'Aquarius|2016', 'Carandiru|2003', 'Black Orpheus|1959', 'Neighboring Sounds|2012', "I'm Still Here|2024", 'Pixote|1980', '3%|2016|s', 'Invisible City|2021|s', 'The Mechanism|2018|s']) },
  { id: 'uk', name: 'United Kingdom', x: 476, y: 130, flag: ['#2b5fb8', '#fff8ea', '#c8473f'], blurb: 'Kitchen-sink realism, gangsters and very dry jokes.',
    titles: L(['Trainspotting|1996', 'Lock, Stock and Two Smoking Barrels|1998', 'Snatch|2000', 'The Third Man|1949', 'Hot Fuzz|2007', 'Paddington 2|2017', 'Four Weddings and a Funeral|1994', 'The Zone of Interest|2023', 'Aftersun|2022', 'Kes|1969', 'Peaky Blinders|2013|s', 'Fleabag|2016|s', 'Sherlock|2010|s', 'Black Mirror|2011|s', 'Line of Duty|2012|s', 'The Office|2001|s', 'Top Boy|2011|s']) },
  { id: 'germany', name: 'Germany', x: 512, y: 138, flag: ['#1e1630', '#c8473f', '#ffd23f'], blurb: 'Expressionist shadows, Cold War paranoia, time loops.',
    titles: L(['Run Lola Run|1998', 'The Lives of Others|2006', 'Good Bye Lenin!|2003', 'Das Boot|1981', 'Downfall|2004', 'Metropolis|1927', 'Nosferatu|1922', 'Wings of Desire|1987', 'All Quiet on the Western Front|2022', 'Toni Erdmann|2016', 'Victoria|2015', 'The White Ribbon|2009', 'Head-On|2004', 'Dark|2017|s', 'Babylon Berlin|2017|s', 'Deutschland 83|2015|s']) },
  { id: 'nordic', name: 'Scandinavia', x: 528, y: 96, flag: ['#2b5fb8', '#ffd23f'], blurb: 'Existential chess with Death, and very cold murders.',
    titles: L(['The Seventh Seal|1957', 'Persona|1966', 'Fanny and Alexander|1982', 'Another Round|2020', 'The Hunt|2012', 'Let the Right One In|2008', 'The Worst Person in the World|2021', 'The Celebration|1998', 'Force Majeure|2014', 'Triangle of Sadness|2022', 'The Girl with the Dragon Tattoo|2009', 'Border|2018', 'Headhunters|2011', 'Trollhunter|2010', 'Borgen|2010|s', 'The Bridge|2011|s', 'The Killing|2007|s']) },
  { id: 'turkey', name: 'Turkey', x: 580, y: 184, flag: ['#c8473f', '#fff8ea'], blurb: 'Long Anatolian nights, sweeping sagas, street cats.',
    titles: L(['Winter Sleep|2014', 'Once Upon a Time in Anatolia|2011', 'Mustang|2015', 'The Wild Pear Tree|2018', 'Three Monkeys|2008', 'Kedi|2016', 'Distant|2002', 'Yol|1982', 'Honey|2010', 'Ayla: The Daughter of War|2017', 'Miracle in Cell No. 7|2019', 'Ethos|2020|s', 'The Protector|2018|s', 'Magnificent Century|2011|s']) },
  { id: 'egypt', name: 'Egypt', x: 566, y: 232, flag: ['#c8473f', '#fff8ea', '#1e1630'], blurb: 'Golden-age melodrama and Cairo after dark.',
    titles: L(['Cairo Station|1958', 'The Night of Counting the Years|1969', 'The Yacoubian Building|2006', 'Clash|2016', 'Cairo 678|2010', 'Yomeddine|2018', 'The Nile Hilton Incident|2017', 'Terrorism and Kebab|1992', 'Sheikh Jackson|2017', 'Microphone|2010', 'Cairo Conspiracy|2022', 'Paranormal|2020|s', 'Finding Ola|2022|s']) },
  { id: 'iran', name: 'Iran', x: 638, y: 210, flag: ['#1fb58f', '#fff8ea', '#c8473f'], blurb: 'Poetic realism: small stories, enormous hearts.',
    titles: L(['A Separation|2011', 'Taste of Cherry|1997', 'Children of Heaven|1997', 'The Salesman|2016', 'Close-Up|1990', 'The White Balloon|1995', 'About Elly|2009', "Leila's Brothers|2022", 'Holy Spider|2022', 'A Girl Walks Home Alone at Night|2014', 'Offside|2006', 'Taxi|2015', 'The Seed of the Sacred Fig|2024', 'No Bears|2022', 'Hit the Road|2021']) },
  { id: 'hongkong', name: 'Hong Kong & China', x: 800, y: 236, flag: ['#c8473f', '#ffd23f'], blurb: 'Neon romance, heroic bloodshed and flying swords.',
    titles: L(['In the Mood for Love|2000', 'Chungking Express|1994', 'Infernal Affairs|2002', 'Hard Boiled|1992', 'A Better Tomorrow|1986', 'Crouching Tiger, Hidden Dragon|2000', 'Hero|2002', 'Farewell My Concubine|1993', 'Raise the Red Lantern|1991', 'Police Story|1985', 'Kung Fu Hustle|2004', 'Ip Man|2008', 'The Wandering Earth|2019', 'Election|2005', 'Better Days|2019', 'Nirvana in Fire|2015|s']) },
];

// ---------------------------------------------------------------- collections (watch order)
export const COLLECTIONS = [
  { slug: 'mcu', name: 'Marvel Cinematic Universe', note: 'chronological order', color: '#c8473f',
    titles: L(['Captain America: The First Avenger|2011', 'Captain Marvel|2019', 'Iron Man|2008', 'Iron Man 2|2010', 'The Incredible Hulk|2008', 'Thor|2011', 'The Avengers|2012', 'Iron Man 3|2013', 'Thor: The Dark World|2013', 'Captain America: The Winter Soldier|2014', 'Guardians of the Galaxy|2014', 'Guardians of the Galaxy Vol. 2|2017', 'Avengers: Age of Ultron|2015', 'Ant-Man|2015', 'Captain America: Civil War|2016', 'Black Widow|2021', 'Black Panther|2018', 'Spider-Man: Homecoming|2017', 'Doctor Strange|2016', 'Thor: Ragnarok|2017', 'Ant-Man and the Wasp|2018', 'Avengers: Infinity War|2018', 'Avengers: Endgame|2019', 'WandaVision|2021|s', 'Spider-Man: Far from Home|2019', 'Shang-Chi and the Legend of the Ten Rings|2021', 'Eternals|2021', 'Spider-Man: No Way Home|2021', 'Doctor Strange in the Multiverse of Madness|2022', 'Thor: Love and Thunder|2022', 'Black Panther: Wakanda Forever|2022', 'Ant-Man and the Wasp: Quantumania|2023', 'Guardians of the Galaxy Vol. 3|2023', 'The Marvels|2023', 'Deadpool & Wolverine|2024', 'Captain America: Brave New World|2025', 'Thunderbolts*|2025', 'The Fantastic Four: First Steps|2025']) },
  { slug: 'star-wars', name: 'Star Wars', note: 'saga timeline', color: '#1e1630',
    titles: L(['Star Wars: Episode I - The Phantom Menace|1999', 'Star Wars: Episode II - Attack of the Clones|2002', 'Star Wars: Episode III - Revenge of the Sith|2005', 'Solo: A Star Wars Story|2018', 'Andor|2022|s', 'Rogue One: A Star Wars Story|2016', 'Star Wars: Episode IV - A New Hope|1977', 'Star Wars: Episode V - The Empire Strikes Back|1980', 'Star Wars: Episode VI - Return of the Jedi|1983', 'The Mandalorian|2019|s', 'Star Wars: Episode VII - The Force Awakens|2015', 'Star Wars: Episode VIII - The Last Jedi|2017', 'Star Wars: Episode IX - The Rise of Skywalker|2019']) },
  { slug: 'middle-earth', name: 'Middle-earth', note: 'Second Age → Third Age', color: '#7a8f5a',
    titles: L(['The Lord of the Rings: The Rings of Power|2022|s', 'The Lord of the Rings: The War of the Rohirrim|2024', 'The Hobbit: An Unexpected Journey|2012', 'The Hobbit: The Desolation of Smaug|2013', 'The Hobbit: The Battle of the Five Armies|2014', 'The Lord of the Rings: The Fellowship of the Ring|2001', 'The Lord of the Rings: The Two Towers|2002', 'The Lord of the Rings: The Return of the King|2003']) },
  { slug: 'wizarding-world', name: 'Wizarding World', note: 'Grindelwald → Voldemort', color: '#8a5a44',
    titles: L(['Fantastic Beasts and Where to Find Them|2016', 'Fantastic Beasts: The Crimes of Grindelwald|2018', 'Fantastic Beasts: The Secrets of Dumbledore|2022', "Harry Potter and the Sorcerer's Stone|2001", 'Harry Potter and the Chamber of Secrets|2002', 'Harry Potter and the Prisoner of Azkaban|2004', 'Harry Potter and the Goblet of Fire|2005', 'Harry Potter and the Order of the Phoenix|2007', 'Harry Potter and the Half-Blood Prince|2009', 'Harry Potter and the Deathly Hallows: Part 1|2010', 'Harry Potter and the Deathly Hallows: Part 2|2011']) },
  { slug: 'ghibli', name: 'Studio Ghibli', note: 'release order', color: '#1fb58f',
    titles: L(['Nausicaä of the Valley of the Wind|1984', 'Castle in the Sky|1986', 'My Neighbor Totoro|1988', 'Grave of the Fireflies|1988', "Kiki's Delivery Service|1989", 'Only Yesterday|1991', 'Porco Rosso|1992', 'Pom Poko|1994', 'Whisper of the Heart|1995', 'Princess Mononoke|1997', 'My Neighbors the Yamadas|1999', 'Spirited Away|2001', 'The Cat Returns|2002', "Howl's Moving Castle|2004", 'Ponyo|2008', 'Arrietty|2010', 'From Up on Poppy Hill|2011', 'The Wind Rises|2013', 'The Tale of the Princess Kaguya|2013', 'When Marnie Was There|2014', 'The Boy and the Heron|2023']) },
  { slug: 'pixar', name: 'Pixar', note: 'release order', color: '#2b5fb8',
    titles: L(['Toy Story|1995', "A Bug's Life|1998", 'Toy Story 2|1999', 'Monsters, Inc.|2001', 'Finding Nemo|2003', 'The Incredibles|2004', 'Cars|2006', 'Ratatouille|2007', 'WALL·E|2008', 'Up|2009', 'Toy Story 3|2010', 'Brave|2012', 'Inside Out|2015', 'Coco|2017', 'Incredibles 2|2018', 'Soul|2020', 'Luca|2021', 'Turning Red|2022', 'Elemental|2023', 'Inside Out 2|2024']) },
  { slug: 'nolan', name: 'Christopher Nolan', note: 'the filmography', color: '#1e1630',
    titles: L(['Following|1998', 'Memento|2000', 'Insomnia|2002', 'Batman Begins|2005', 'The Prestige|2006', 'The Dark Knight|2008', 'Inception|2010', 'The Dark Knight Rises|2012', 'Interstellar|2014', 'Dunkirk|2017', 'Tenet|2020', 'Oppenheimer|2023']) },
  { slug: 'mission-impossible', name: 'Mission: Impossible', note: 'this message will self-destruct', color: '#c8473f',
    titles: L(['Mission: Impossible|1996', 'Mission: Impossible II|2000', 'Mission: Impossible III|2006', 'Mission: Impossible - Ghost Protocol|2011', 'Mission: Impossible - Rogue Nation|2015', 'Mission: Impossible - Fallout|2018', 'Mission: Impossible - Dead Reckoning Part One|2023', 'Mission: Impossible - The Final Reckoning|2025']) },
  { slug: 'john-wick', name: 'John Wick', note: 'with the spin-offs', color: '#1e1630',
    titles: L(['The Continental: From the World of John Wick|2023|s', 'John Wick|2014', 'John Wick: Chapter 2|2017', 'John Wick: Chapter 3 - Parabellum|2019', 'Ballerina|2025', 'John Wick: Chapter 4|2023']) },
  { slug: 'fast-furious', name: 'Fast & Furious', note: 'story order (Tokyo Drift after 6)', color: '#ff8a3d',
    titles: L(['The Fast and the Furious|2001', '2 Fast 2 Furious|2003', 'Fast & Furious|2009', 'Fast Five|2011', 'Fast & Furious 6|2013', 'The Fast and the Furious: Tokyo Drift|2006', 'Furious 7|2015', 'The Fate of the Furious|2017', 'Fast & Furious Presents: Hobbs & Shaw|2019', 'F9|2021', 'Fast X|2023']) },
  { slug: 'alien', name: 'Alien', note: 'chronological', color: '#1fb58f',
    titles: L(['Prometheus|2012', 'Alien: Covenant|2017', 'Alien|1979', 'Alien: Romulus|2024', 'Aliens|1986', 'Alien³|1992', 'Alien Resurrection|1997', 'Alien: Earth|2025|s']) },
  { slug: 'godfather', name: 'The Godfather', note: 'an offer you can\'t refuse', color: '#8a5a44',
    titles: L(['The Godfather|1972', 'The Godfather Part II|1974', 'The Godfather Part III|1990']) },
  { slug: 'back-to-the-future', name: 'Back to the Future', note: 'great Scott!', color: '#ff8a3d',
    titles: L(['Back to the Future|1985', 'Back to the Future Part II|1989', 'Back to the Future Part III|1990']) },
  { slug: 'toy-story', name: 'Toy Story', note: 'to infinity', color: '#2b5fb8',
    titles: L(['Toy Story|1995', 'Toy Story 2|1999', 'Toy Story 3|2010', 'Toy Story 4|2019', 'Lightyear|2022']) },
  { slug: 'jurassic', name: 'Jurassic', note: 'life finds a way', color: '#7a8f5a',
    titles: L(['Jurassic Park|1993', 'The Lost World: Jurassic Park|1997', 'Jurassic Park III|2001', 'Jurassic World|2015', 'Jurassic World: Fallen Kingdom|2018', 'Jurassic World Dominion|2022', 'Jurassic World Rebirth|2025']) },
  { slug: 'bond-craig', name: 'James Bond: the Craig era', note: 'shaken, not stirred', color: '#1e1630',
    titles: L(['Casino Royale|2006', 'Quantum of Solace|2008', 'Skyfall|2012', 'Spectre|2015', 'No Time to Die|2021']) },
  { slug: 'dc', name: 'DC: Snyderverse & the Batmen', note: 'capes, cowls, rain', color: '#2b5fb8',
    titles: L(['Man of Steel|2013', 'Batman v Superman: Dawn of Justice|2016', 'Suicide Squad|2016', 'Wonder Woman|2017', "Zack Snyder's Justice League|2021", 'Aquaman|2018', 'Shazam!|2019', 'Batman|1989', 'Batman Returns|1992', 'Batman Begins|2005', 'The Dark Knight|2008', 'The Dark Knight Rises|2012', 'Joker|2019', 'The Batman|2022']) },
  { slug: 'dune', name: 'Dune', note: 'the spice must flow', color: '#d9a441',
    titles: L(['Dune: Prophecy|2024|s', 'Dune|1984', 'Dune|2021', 'Dune: Part Two|2024']) },
  { slug: 'pirates', name: 'Pirates of the Caribbean', note: 'savvy?', color: '#8a5a44',
    titles: L(['Pirates of the Caribbean: The Curse of the Black Pearl|2003', "Pirates of the Caribbean: Dead Man's Chest|2006", "Pirates of the Caribbean: At World's End|2007", 'Pirates of the Caribbean: On Stranger Tides|2011', 'Pirates of the Caribbean: Dead Men Tell No Tales|2017']) },
  { slug: 'conjuring', name: 'The Conjuring Universe', note: 'chronological, lights on', color: '#1e1630',
    titles: L(['The Nun|2018', 'Annabelle: Creation|2017', 'The Nun II|2023', 'Annabelle|2014', 'The Conjuring|2013', 'Annabelle Comes Home|2019', 'The Conjuring 2|2016', 'The Curse of La Llorona|2019', 'The Conjuring: The Devil Made Me Do It|2021', 'The Conjuring: Last Rites|2025']) },
  { slug: 'spider-man', name: 'Spider-Man & the Spider-Verse', note: 'every web, in release order', color: '#c8473f',
    titles: L(['Spider-Man|2002', 'Spider-Man 2|2004', 'Spider-Man 3|2007', 'The Amazing Spider-Man|2012', 'The Amazing Spider-Man 2|2014', 'Spider-Man: Into the Spider-Verse|2018', 'Spider-Man: Across the Spider-Verse|2023']) },
  { slug: 'monsterverse', name: 'Monsterverse', note: 'chronological, big lizards', color: '#1fb58f',
    titles: L(['Kong: Skull Island|2017', 'Godzilla|2014', 'Monarch: Legacy of Monsters|2023|s', 'Godzilla: King of the Monsters|2019', 'Godzilla vs. Kong|2021', 'Godzilla x Kong: The New Empire|2024']) },
];

// ---------------------------------------------------------------- people
export const PEOPLE = [
  ['Christopher Nolan', 'director'], ['Denis Villeneuve', 'director'], ['Greta Gerwig', 'director'], ['Quentin Tarantino', 'director'],
  ['Martin Scorsese', 'director'], ['Steven Spielberg', 'director'], ['Hayao Miyazaki', 'director'], ['Bong Joon Ho', 'director'],
  ['Zendaya', 'actor'], ['Timothée Chalamet', 'actor'], ['Florence Pugh', 'actor'], ['Cillian Murphy', 'actor'],
  ['Margot Robbie', 'actor'], ['Ryan Gosling', 'actor'], ['Leonardo DiCaprio', 'actor'], ['Meryl Streep', 'actor'],
  ['Denzel Washington', 'actor'], ['Keanu Reeves', 'actor'], ['Tom Cruise', 'actor'], ['Viola Davis', 'actor'],
  ['Pedro Pascal', 'actor'], ['Anya Taylor-Joy', 'actor'], ['Song Kang-ho', 'actor'], ['Scarlett Johansson', 'actor'],
].map(([name, role]) => ({ name, role }));

// ---------------------------------------------------------------- resolving
// Cinemeta starts erroring (without CORS headers) when ~20 searches land at once, so resolve a few at a time
// and retry a failure once. Keeps list order; unresolved titles are dropped.
import { resolveTitle } from '../core/meta.js';
export async function resolveList(list, n = 4) {
  const out = new Array(list.length);
  let i = 0;
  const one = t => resolveTitle(t.name, t.year, t.type);
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < list.length) {
      const k = i++;
      try { out[k] = await one(list[k]); }
      catch { try { await new Promise(r => setTimeout(r, 600)); out[k] = await one(list[k]); } catch { out[k] = null; } }
    }
  }));
  return out.filter(Boolean);
}
