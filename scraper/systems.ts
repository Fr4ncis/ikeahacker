import type { SystemDef } from '../src/lib/types.ts'

/**
 * The IKEA systems we scrape. `query` is the search phrase; results are then
 * filtered down to products whose name matches the system id or an alias, so
 * a broad query is fine (and better than a narrow one that misses variants).
 */
export const SYSTEMS: SystemDef[] = [
  // --- Wardrobe / clothes storage ---
  { id: 'PAX', query: 'pax wardrobe', category: 'wardrobe', blurb: 'Full-height modular wardrobe frames and combinations.' },
  { id: 'KOMPLEMENT', query: 'komplement', category: 'wardrobe', blurb: 'Interior fittings that go inside PAX frames.' },
  { id: 'PLATSA', query: 'platsa', category: 'wardrobe', blurb: 'Low-profile modular storage that adapts to awkward walls.' },
  { id: 'ELVARLI', query: 'elvarli', category: 'wardrobe', blurb: 'Open post-based shelving for walk-in wardrobes.' },
  { id: 'BOAXEL', query: 'boaxel', category: 'wardrobe', blurb: 'Wall-mounted rail storage for utility rooms and wardrobes.', wallMountable: true },
  { id: 'STUK', query: 'stuk storage', category: 'wardrobe', blurb: 'Soft boxes and bags for wardrobe interiors.' },

  // --- Shelving / open storage ---
  { id: 'BILLY', query: 'billy bookcase', category: 'shelving', blurb: 'The bookcase. Narrow, deep, tall or short.', aliases: ['OXBERG', 'BILLY / OXBERG'] },
  { id: 'KALLAX', query: 'kallax', category: 'shelving', blurb: 'Square-grid cube shelving, freestanding or on its side.' },
  { id: 'IVAR', query: 'ivar', category: 'shelving', blurb: 'Untreated pine post-and-shelf system.' },
  { id: 'EKET', query: 'eket', category: 'shelving', blurb: 'Small coloured cabinets you stack and hang in patterns.', wallMountable: true },
  { id: 'BESTA', label: 'BESTÅ', query: 'besta', category: 'living', blurb: 'Media and living-room storage, floor or wall mounted.', aliases: ['BESTÅ'], wallMountable: true },
  { id: 'LACK', query: 'lack shelf table', category: 'living', blurb: 'Cheap floating shelves and side tables.', wallMountable: true },
  { id: 'HYLLIS', query: 'hyllis', category: 'utility', blurb: 'Galvanised steel shelving for balconies and basements.' },
  { id: 'OMAR', query: 'omar shelving', category: 'utility', blurb: 'Zinc-plated wire shelving for pantries and garages.' },
  { id: 'JONAXEL', query: 'jonaxel', category: 'utility', blurb: 'Open frame-and-basket storage.' },
  { id: 'VIHALS', query: 'vihals', category: 'shelving', blurb: 'Slim-lined modern shelving and cabinets.' },
  { id: 'TONSTAD', query: 'tonstad', category: 'living', blurb: 'Oak-veneer cabinets and shelves with a heavier look.' },
  { id: 'HAVSTA', query: 'havsta', category: 'living', blurb: 'Solid pine traditional cabinets and glass-door units.' },

  // --- Kitchen ---
  { id: 'METOD', query: 'metod kitchen cabinet', category: 'kitchen', blurb: 'The kitchen cabinet system: base, wall and high cabinets.', wallMountable: true },
  { id: 'ENHET', query: 'enhet', category: 'kitchen', blurb: 'Compact kitchen and bathroom modules on frames or walls.', wallMountable: true },

  // --- Bedroom ---
  { id: 'MALM', query: 'malm', category: 'bedroom', blurb: 'Clean-lined beds and chests of drawers.' },
  { id: 'HEMNES', query: 'hemnes', category: 'bedroom', blurb: 'Solid wood traditional beds, chests and cabinets.' },
  { id: 'NORDLI', query: 'nordli', category: 'bedroom', blurb: 'Modular chests you combine to any width.' },
  { id: 'BRIMNES', query: 'brimnes', category: 'bedroom', blurb: 'Budget beds, wardrobes and cabinets.' },
  { id: 'IDANAS', label: 'IDANÄS', query: 'idanas', category: 'bedroom', blurb: 'Panelled cottage-style bedroom furniture.', aliases: ['IDANÄS'] },
  { id: 'SMASTAD', label: 'SMÅSTAD', query: 'smastad', category: 'kids', blurb: "Children's modular storage with low, safe heights.", aliases: ['SMÅSTAD', 'SMÅSTAD / PLATSA'] },
  { id: 'TROFAST', query: 'trofast', category: 'kids', blurb: 'Frames with sliding toy boxes.' },

  // --- Desks / office ---
  { id: 'ALEX', query: 'alex desk drawer', category: 'office', blurb: 'Desks and drawer units with a flush front.' },
  { id: 'MICKE', query: 'micke', category: 'office', blurb: 'Compact desks with cable management.' },
  { id: 'BEKANT', query: 'bekant', category: 'office', blurb: 'Office desks including sit/stand versions.' },
  { id: 'TROTTEN', query: 'trotten', category: 'office', blurb: 'Crank-adjustable desks and matching cabinets.' },
  { id: 'IDASEN', label: 'IDÅSEN', query: 'idasen', category: 'office', blurb: 'Premium office desks and drawer units.', aliases: ['IDÅSEN'] },

  // --- Seating / tables, so a room actually reads as a room ---
  { id: 'KIVIK', query: 'kivik sofa', category: 'seating', blurb: 'Deep modular sofa sections and chaise longues.' },
  { id: 'VIMLE', query: 'vimle sofa', category: 'seating', blurb: 'Modular sofa you build seat by seat.' },
  { id: 'SODERHAMN', label: 'SÖDERHAMN', query: 'soderhamn sofa', category: 'seating', blurb: 'Low modular sofa with a relaxed profile.', aliases: ['SÖDERHAMN'] },
  { id: 'FRIHETEN', query: 'friheten', category: 'seating', blurb: 'Corner sofa-bed with storage.' },
  { id: 'POANG', label: 'POÄNG', query: 'poang', category: 'seating', blurb: 'Bentwood armchairs and footstools.', aliases: ['POÄNG'] },
  { id: 'STRANDMON', query: 'strandmon', category: 'seating', blurb: 'Wing-back armchairs.' },
  { id: 'LISABO', query: 'lisabo', category: 'table', blurb: 'Ash-veneer tables and desks.' },
  { id: 'EKEDALEN', query: 'ekedalen', category: 'table', blurb: 'Extendable dining tables and chairs.' },
  { id: 'NORDEN', query: 'norden table', category: 'table', blurb: 'Birch gateleg and dining tables.' },
  { id: 'INGATORP', query: 'ingatorp', category: 'table', blurb: 'Round and oval extendable dining tables.' },
]
