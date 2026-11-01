'use strict';

const GPSBathymetry = (() => {
  const CONTOUR_LAYERS = ['contour-lines', 'contour-labels', 'soundings', 'depth-coverage'];
  const CHART_LAYERS = ['depth-shading', 'depth-areas', 'depth-hillshade'];
  const TOPO_LAYERS = ['depth-topo', 'depth-topo-hillshade'];
  // Open Waters' chart view stresses the 10 m contour, and the 2 m one from zoom 11 near the coast.
  const NEAR_COAST_ZOOM = 11;
  const COLOURS = {
    chart: { major: '#4c5b63', minor: '#657f8c', text: '#4f6874' },
    topo: { major: '#1f1f1f', minor: '#3a3a3a', text: '#222222' }
  };

  /* Open Waters ships both metric and feet contour sets (sys "m" / "ft") and soundings in both units. */
  function units(config) {
    const feet = config.depthUnits === 'ft';
    const major = depth => ['==', ['get', feet ? 'depth_ft' : 'depth_abs_m'], depth];
    return {
      contourFilter: feet ? ['==', ['get', 'sys'], 'ft'] : ['!=', ['get', 'sys'], 'ft'],
      contourMajor: feet ? [major(30), major(6)] : [major(10), major(2)],
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

  function scheme(config) {
    return config.depthColours === 'topo' ? 'topo' : 'chart';
  }

  // Zoom must be the outermost expression, so the major contour is chosen inside each step.
  function contourPaint(config) {
    const [offshore, nearCoast] = units(config).contourMajor;
    const colours = COLOURS[scheme(config)];
    const byZoom = (major, minor) => [
      'step', ['zoom'],
      ['case', offshore, major, minor],
      NEAR_COAST_ZOOM, ['case', nearCoast, major, minor]
    ];
    return {
      lineColor: byZoom(colours.major, colours.minor),
      lineWidth: byZoom(1.6, 0.9),
      textColor: colours.text
    };
  }

  function visibility(config) {
    const contours = config.bathymetryEnabled !== false;
    const shading = contours && config.bathymetryShading === true;
    const topo = scheme(config) === 'topo';
    return { contours, chart: shading && !topo, topo: shading && topo };
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
      },
      // Which survey each area's depths come from, with its name and deepest useful zoom.
      'seascape-coverage': {
        type: 'vector',
        url: wrapUrl('https://tiles.openwaters.io/seascape/coverage.json'),
        attribution: '© Open Waters · EMODnet · GEBCO'
      }
    };
  }

  function layers(config) {
    const shown = visibility(config);
    const contourVisibility = shown.contours ? 'visible' : 'none';
    const shadingVisibility = shown.chart ? 'visible' : 'none';
    const topoVisibility = shown.topo ? 'visible' : 'none';
    const unit = units(config);
    const paint = contourPaint(config);

    return [
      {
        // Invisible: only queried for the depth source under the boat or the chart centre.
        id: 'depth-coverage',
        type: 'fill',
        source: 'seascape-coverage',
        'source-layer': 'coverage',
        layout: { visibility: contourVisibility },
        paint: { 'fill-opacity': 0 }
      },
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
        // Open Waters' Topo view: a colour per depth band shows banks and channels at a glance.
        // Land above the drying height is left clear so the base chart shows through.
        id: 'depth-topo',
        type: 'color-relief',
        source: 'seascape-dem',
        layout: { visibility: topoVisibility },
        paint: {
          'color-relief-color': [
            'interpolate', ['linear'], ['elevation'],
            -11000, '#0d1340', -6000, '#18246e', -3000, '#1f3fb0', -1000, '#1f6fd6',
            -200, '#1aa0d8', -90, '#33c9b8', -55, '#7fd04a', -35, '#f2e33a',
            -18, '#f59331', -5, '#e8402f', 0, '#d7263d',
            0.00390625, '#f4b6c8', 1.99609375, '#f4b6c8',
            2, 'rgba(244,182,200,0)'
          ],
          'color-relief-opacity': 0.85,
          'resampling': 'nearest'
        }
      },
      {
        id: 'depth-topo-hillshade',
        type: 'hillshade',
        source: 'seascape-dem',
        layout: { visibility: topoVisibility },
        paint: {
          'hillshade-method': 'igor',
          'hillshade-exaggeration': 0.3
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
          'line-color': paint.lineColor,
          'line-width': paint.lineWidth,
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
          'text-color': paint.textColor,
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
          'text-color': paint.textColor,
          'text-halo-color': 'rgba(255,255,255,0.75)',
          'text-halo-width': 1
        }
      }
    ];
  }

  function applyVisibility(map, config) {
    if (!map) return;
    const shown = visibility(config);
    const set = (ids, visible) => {
      for (const id of ids) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    };
    set(CONTOUR_LAYERS, shown.contours);
    set(CHART_LAYERS, shown.chart);
    set(TOPO_LAYERS, shown.topo);
  }

  /* Applies the depth units and the colour scheme to the contour and sounding layers. */
  function applyStyle(map, config) {
    if (!map || !map.getLayer('contour-lines')) return;
    const unit = units(config);
    const paint = contourPaint(config);
    map.setFilter('contour-lines', unit.contourFilter);
    map.setPaintProperty('contour-lines', 'line-color', paint.lineColor);
    map.setPaintProperty('contour-lines', 'line-width', paint.lineWidth);
    map.setFilter('contour-labels', unit.contourFilter);
    map.setLayoutProperty('contour-labels', 'text-field', unit.contourLabel);
    map.setPaintProperty('contour-labels', 'text-color', paint.textColor);
    map.setLayoutProperty('soundings', 'text-field', unit.sounding);
    map.setPaintProperty('soundings', 'text-color', paint.textColor);
    applyVisibility(map, config);
  }

  /* The surveys under a screen point, most detailed first: [{ id, name, maxzoom }]. */
  function sourcesAt(map, point) {
    if (!map || !map.getLayer('depth-coverage')) return [];
    const found = new Map();
    for (const feature of map.queryRenderedFeatures(point, { layers: ['depth-coverage'] })) {
      const { source_id: id, source_name: name, source_maxzoom: maxzoom } = feature.properties;
      if (id && name) found.set(id, { id, name, maxzoom: Number(maxzoom) || 0 });
    }
    return [...found.values()].sort((a, b) => b.maxzoom - a.maxzoom);
  }

  return { sources, layers, applyVisibility, applyStyle, sourcesAt };
})();
