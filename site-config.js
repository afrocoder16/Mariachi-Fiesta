/* Mariachi Fiesta - Google listing settings.

   placeId, rating and reviewCount below are the real published values for
   329 W Main St, Marshall MN, read from the restaurant's Google listing on
   2026-08-14. Refresh `rating` / `reviewCount` now and then, or set
   placesApiKey and they update themselves on every page load.

   placesApiKey: leave blank and the page shows the star rating above plus a
   link to the reviews on Google. Paste a Google Places API (New) key and the
   page also pulls the five most helpful review quotes straight from Google,
   with the reviewer's name and a link to their profile. Create the key in
   Google Cloud, enable "Places API (New)", and restrict it to this site's
   domain - a browser key is public by design, so the referrer restriction is
   what keeps it from being used elsewhere. */

window.MARIACHI_GOOGLE = {
  placeId: 'ChIJqx9J_wxZiocRCXNuQPg2Ikk',
  mapQuery: 'Mariachi Fiesta, 329 W Main St, Marshall, MN 56258',
  mapsUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJqx9J_wxZiocRCXNuQPg2Ikk',
  reviewsUrl: 'https://search.google.com/local/reviews?placeid=ChIJqx9J_wxZiocRCXNuQPg2Ikk',
  writeReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJqx9J_wxZiocRCXNuQPg2Ikk',
  directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=Mariachi+Fiesta%2C+329+W+Main+St%2C+Marshall%2C+MN+56258&destination_place_id=ChIJqx9J_wxZiocRCXNuQPg2Ikk',

  rating: 4.4,
  reviewCount: 425,
  ratingCheckedOn: 'August 2026',

  placesApiKey: '',

  /* Shown in place of review quotes until an API key is set. These are the
     things guests bring up most across the restaurant's public reviews -
     summarised topics, not quotes attributed to anyone. */
  highlights: [
    { label: 'The house salsa', note: 'The thing regulars talk about first.' },
    { label: 'Margaritas', note: 'Generous pours, especially on weekends.' },
    { label: 'Sizzling fajitas', note: 'Ordered across half the dining room.' },
    { label: 'Big portions', note: 'Nobody leaves hungry.' },
    { label: 'Friendly service', note: 'The owner still stops by tables.' },
    { label: 'Fair prices', note: 'Plenty of plate for the money.' },
  ],
};
