'use strict';

const GPSBathymetry = (() => {
  const CONTOUR_LAYERS = ['contour-lines', 'contour-labels', 'soundings'];
  const SHADING_LAYERS = ['depth-shading', 'depth-areas', 'depth-hillshade'];

  /* Open Waters ships both metric and feet contour sets (sys "m" / "ft") and soundings in both units. */
  function units(config) {
    const feet = config.depthUnits === 'ft';
    return {
      contourFilter: feet ? ['==', ['get', 'sys'], 'ft'] : ['!=', ['get', 'sys'], 'ft'],
      contourMajor: feet ? ['==', ['get', 'depth_ft'], 30] : ['==', ['get', 'depth_abs_m'], 10],
      contourLabel: ['to-string', ['get', feet ? 'depth_ft' : 'depth_abs_m']],
      sounding: feet
        ? ['to-string', ['round', ['get', 'depth_ft']]]
        : [
          'concat',
          ['to-string', ['floor', ['get', 'depth_m']]],
          [
            'match', ['round', ['*', 10, ['%', ['get', 'depth_m'], 1]]],
            1, ' ₁', 2, ' ₂', 3, ' ₃', 4, ' ₄', 5, ' ₅',
            6, ' ₆', 7, ' ₇', 8, ' ₈', 9, ' ₉', ''
          ]
        ]
    };
  }

  function sources(wrapUrl = url => url) {
    return {
      'seascape-dem': {
        type: 'raster-dem',
        url: wrapUrl('https://tiles.openwaters.io/seascape/raster.json'),
        tileSize: 512,
        encoding: 'terrarium',
        attribution: '© Open Waters · EMODnet · GEBCO'
      },
      'seascape-vector': {
        type: 'vector',
        url: wrapUrl('https://tiles.openwaters.io/seascape/vector.json'),
        attribution: '© Open Waters · EMODnet · GEBCO'
      }
    };
  }

  function layers(config) {
    const contoursVisible = config.bathymetryEnabled !== false;
    const shadingVisible = contoursVisible && config.bathymetryShading === true;
    const contourVisibility = contoursVisible ? 'visible' : 'none';
    const shadingVisibility = shadingVisible ? 'visible' : 'none';
    const unit = units(config);

    return [
      {
        id: 'depth-shading',
        type: 'color-relief',
        source: 'seascape-dem',
        layout: { visibility: shadingVisibility },
        paint: {
          'color-relief-color': [
            'interpolate', ['linear'], ['elevation'],
            -10000, '#e9f7ff', -50, '#e9f7ff',
            -49.9, '#c9e9fd', -20, '#c9e9fd',
            -19.9, '#a5d9fb', -10, '#a5d9fb',
            -9.9, '#7fc7f8', -5, '#7fc7f8',
            -4.9, '#5db5f0', -2, '#5db5f0',
            -1.99, '#1f86cb', -0.00390625, '#1f86cb',
            0, '#1f86cb', 0.00390625, '#58af9c',
            1, '#58af9c', 1.99609375, '#58af9c',
            2, 'rgba(247,240,221,0.66)'
          ],
          'color-relief-opacity': 0.7,
          'resampling': 'nearest'
        }
      },
      {
        id: 'depth-areas',
        type: 'fill',
        source: 'seascape-vector',
        'source-layer': 'depare',
        filter: ['!', ['has', 'sys']],
        minzoom: 4,
        layout: {
          visibility: shadingVisibility,
          'fill-sort-key': ['get', 'rank']
        },
        paint: {
          'fill-color': [
            'case',
            ['!', ['has', 'drval1']], '#1f86cb',
            ['<', ['get', 'drval1'], 0], '#58af9c',
            [
              'case',
              ['<', ['get', 'drval1'], 1.99], '#1f86cb',
              [
                'step', ['get', 'drval1'],
                '#3fa2e4', 1.99, '#5db5f0', 4.99, '#7fc7f8',
                9.99, '#a5d9fb', 19.99, '#c9e9fd', 49.99, '#e9f7ff'
              ]
            ]
          ],
          'fill-opacity': ['case', ['!', ['has', 'drval1']], 0.45, 0.7]
        }
      },
      {
        id: 'depth-hillshade',
        type: 'hillshade',
        source: 'seascape-dem',
        layout: { visibility: shadingVisibility },
        paint: {
          'hillshade-exaggeration': 0.5,
          'hillshade-shadow-color': '#9adcfe',
          'hillshade-highlight-color': '#ffffff',
          'hillshade-illumination-direction': 315
        }
      },
      {
        id: 'contour-lines',
        type: 'line',
        source: 'seascape-vector',
        'source-layer': 'contours',
        filter: unit.contourFilter,
        minzoom: 4,
        layout: {
          visibility: contourVisibility,
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': ['case', unit.contourMajor, '#4c5b63', '#657f8c'],
          'line-width': ['case', unit.contourMajor, 1.6, 0.9],
          'line-opacity': 0.9
        }
      },
      {
        id: 'contour-labels',
        type: 'symbol',
        source: 'seascape-vector',
        'source-layer': 'contours',
        filter: unit.contourFilter,
        minzoom: 8,
        layout: {
          visibility: contourVisibility,
          'symbol-placement': 'line',
          'text-field': unit.contourLabel,
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 12, 13, 16],
          'text-font': ['Noto Sans Medium'],
          'text-letter-spacing': 0.1,
          'text-max-angle': 30,
          'text-padding': 50
        },
        paint: {
          'text-color': '#4f6874',
          'text-halo-color': 'rgba(255,255,255,0.75)',
          'text-halo-width': 1
        }
      },
      {
        id: 'soundings',
        type: 'symbol',
        source: 'seascape-vector',
        'source-layer': 'soundings',
        minzoom: 7,
        layout: {
          visibility: contourVisibility,
          'text-field': unit.sounding,
          'text-font': ['Noto Sans Medium Italic'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 12, 13, 16],
          'text-padding': 8,
          'symbol-sort-key': [
            'case', ['==', ['get', 'prime'], 1], -1000000, ['get', 'depth_m']
          ]
        },
        paint: {
          'text-color': '#4f6874',
          'text-halo-color': 'rgba(255,255,255,0.75)',
          'text-halo-width': 1
        }
      }
    ];
  }

  function applyVisibility(map, config) {
    if (!map) return;
    const contoursVisible = config.bathymetryEnabled !== false;
    const shadingVisible = contoursVisible && config.bathymetryShading === true;
    for (const id of CONTOUR_LAYERS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', contoursVisible ? 'visible' : 'none');
    }
    for (const id of SHADING_LAYERS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', shadingVisible ? 'visible' : 'none');
    }
  }

  function applyUnits(map, config) {
    if (!map || !map.getLayer('contour-lines')) return;
    const unit = units(config);
    map.setFilter('contour-lines', unit.contourFilter);
    map.setPaintProperty('contour-lines', 'line-color', ['case', unit.contourMajor, '#4c5b63', '#657f8c']);
    map.setPaintProperty('contour-lines', 'line-width', ['case', unit.contourMajor, 1.6, 0.9]);
    map.setFilter('contour-labels', unit.contourFilter);
    map.setLayoutProperty('contour-labels', 'text-field', unit.contourLabel);
    map.setLayoutProperty('soundings', 'text-field', unit.sounding);
  }

  return { sources, layers, applyVisibility, applyUnits };
})();
