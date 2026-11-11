// Judith's 3D bricks: what a scene written by the model can build with, in
// Judith's colours. A classic script (no import/export): it runs inside the
// sandboxed scene frame, and in Node for the tests (through vm).
//
//   const engine = J.assembly(stage, [
//     { name: 'Entrée d\'air', shape: 'cone', radius: 1, radiusEnd: 1.3, length: 1 },
//     { name: 'Compresseur', shape: 'cylinder', radius: 1.1, length: 2 },
//     ...
//   ]);
//   J.flow(stage, [-6, 0, 0], [6, 0, 0], { colors: ['sky', 'blush'] });
//   stage.steps(engine.parts.map((part) => ({ target: part })));
(function (root) {
  const PALETTE = {
    iris: 0x8f7cff,
    sky: 0x5cb8ff,
    mint: 0x3ddc97,
    lemon: 0xffd84d,
    blush: 0xff8fb8,
    deep: 0x6b57e8,
    ink: 0x24203a,
    pearl: 0xf5f2ff,
  };
  const CYCLE = [PALETTE.iris, PALETTE.sky, PALETTE.mint, PALETTE.lemon, PALETTE.blush, PALETTE.deep];

  // A palette name, a number, or (none) the next colour of the cycle.
  function colorOf(value, index) {
    if (value == null) return CYCLE[index % CYCLE.length];
    if (typeof value === 'string' && PALETTE[value] != null) return PALETTE[value];
    return value;
  }

  // Centres of parts laid end to end along an axis, centred on 0.
  function layout(lengths, gap) {
    const centres = [];
    let at = 0;
    for (const length of lengths) {
      centres.push(at + length / 2);
      at += length + gap;
    }
    const total = Math.max(0, at - gap);
    return centres.map((c) => c - total / 2);
  }

  // Length of a part along the assembly's axis.
  function extent(part) {
    if (part.shape === 'sphere' || part.shape === 'ring') return (part.radius ?? 1) * 2;
    return part.length ?? 1;
  }

  const DEG = Math.PI / 180;
  // More parts than this is refused (the prompt asks for 8: this only catches the extremes).
  const MAX_PARTS = 12;
  const num = (value, fallback) => (value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback);
  const vec3 = (value, fallback = [0, 0, 0]) => (Array.isArray(value) ? [num(value[0], fallback[0]), num(value[1], fallback[1]), num(value[2], fallback[2])] : fallback);

  // The solid of one part of J.build. y is up. size: [width, height, depth] (or one
  // number for a cube); everything is centred on its own middle, so `at` is its centre.
  function solidGeometry(THREE, part) {
    const r = num(part.radius, 1);
    const size = typeof part.size === 'number' ? [part.size, part.size, part.size] : vec3(part.size, [1, 1, 1]);
    const [w, h, d] = size;
    // A flat outline pulled out over `depth` (its total thickness), edges softened by `bevel`.
    const extrude = (shape, depth, bevel = 0) => {
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(0.01, depth - 2 * bevel),
        bevelEnabled: bevel > 0,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 3,
        curveSegments: 24,
      });
      geometry.center();
      return geometry;
    };
    // Points [[x, y], …] as a closed outline, straight or smoothed through its points (a leaf, a wing, a hull).
    const outlineOf = (points, smooth) => {
      const list = points.filter((p) => Array.isArray(p) && p.length >= 2).map(([x, y]) => new THREE.Vector2(num(x, 0), num(y, 0)));
      if (!smooth || list.length < 3) return new THREE.Shape(list);
      const curve = new THREE.CatmullRomCurve3(list.map((p) => new THREE.Vector3(p.x, p.y, 0)), true, 'catmullrom', 0.5);
      return new THREE.Shape(curve.getPoints(Math.max(48, list.length * 12)).map((p) => new THREE.Vector2(p.x, p.y)));
    };
    const bevelOf = (fallback) => Math.max(0, num(part.bevel, fallback));
    switch (part.shape) {
      case 'ellipsoid': {
        // A smooth body (a head, a hull, a cloud): size is its width, height and depth. Radius alone makes a ball.
        const dims = part.size == null ? [r * 2, r * 2, r * 2] : size;
        return new THREE.SphereGeometry(1, 40, 28).scale(dims[0] / 2, dims[1] / 2, dims[2] / 2);
      }
      case 'capsule':
        // A rounded bar along y: `length` is the straight part between the two round ends.
        return new THREE.CapsuleGeometry(r, num(part.length ?? part.height, 1), 8, 28);
      case 'lathe': {
        // A profile [[radius, height], …] turned round the y axis: a bottle, a dome, a tower, a fuselage
        // (lay it along x with rotate [0, 0, 90]). Smoothed through its points unless smooth: false.
        const raw = (Array.isArray(part.outline) ? part.outline : []).filter((p) => Array.isArray(p) && p.length >= 2);
        if (raw.length < 2) throw new Error('shape "lathe" needs outline: [[radius, height], …] with at least 2 points');
        let points = raw.map(([x, y]) => new THREE.Vector2(Math.max(0, num(x, 0)), num(y, 0)));
        if (part.smooth !== false && points.length >= 3) {
          const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, p.y, 0)), false, 'catmullrom', 0.5);
          points = curve.getPoints(Math.max(32, points.length * 10)).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
        }
        const geometry = new THREE.LatheGeometry(points, 56);
        geometry.center();
        return geometry;
      }
      case 'tube': {
        // A pipe along a path [[x, y, z], …] (points relative to `at`): a cable, a vein, a rail, a handle.
        const path = (Array.isArray(part.points) ? part.points : []).filter((p) => Array.isArray(p) && p.length >= 3);
        if (path.length < 2) throw new Error('shape "tube" needs points: [[x, y, z], …] with at least 2 points');
        const curve = new THREE.CatmullRomCurve3(path.map(([x, y, z]) => new THREE.Vector3(num(x, 0), num(y, 0), num(z, 0))), part.closed === true, 'catmullrom', 0.5);
        return new THREE.TubeGeometry(curve, Math.max(24, path.length * 16), r, 14, part.closed === true);
      }
      case 'roundbox': {
        // A box with rounded corners and soft edges: radius is the corner, bevel the edge.
        const corner = Math.min(num(part.radius, Math.min(w, h) * 0.2), w / 2, h / 2);
        const b = Math.min(bevelOf(Math.min(w, h, d) * 0.08), d / 4, corner);
        const x = w / 2 - b;
        const y = h / 2 - b;
        const c = Math.max(0, corner - b);
        const shape = new THREE.Shape();
        shape.moveTo(-x + c, -y);
        shape.lineTo(x - c, -y);
        shape.quadraticCurveTo(x, -y, x, -y + c);
        shape.lineTo(x, y - c);
        shape.quadraticCurveTo(x, y, x - c, y);
        shape.lineTo(-x + c, y);
        shape.quadraticCurveTo(-x, y, -x, y - c);
        shape.lineTo(-x, -y + c);
        shape.quadraticCurveTo(-x, -y, -x + c, -y);
        return extrude(shape, d, b);
      }
      case 'cylinder':
        return new THREE.CylinderGeometry(r, r, num(part.height, 1), 48);
      case 'cone':
        // radiusEnd: the top (0 = a point).
        return new THREE.CylinderGeometry(num(part.radiusEnd, 0), r, num(part.height, 1), 48);
      case 'sphere':
        return new THREE.SphereGeometry(r, 40, 24);
      case 'ring':
        return new THREE.TorusGeometry(r, num(part.tube, r * 0.15), 16, 48);
      case 'prism': {
        // A triangle (base w, height h, apex in the middle) extruded over d.
        const shape = new THREE.Shape();
        shape.moveTo(-w / 2, -h / 2);
        shape.lineTo(w / 2, -h / 2);
        shape.lineTo(0, h / 2);
        return extrude(shape, d, bevelOf(Math.min(w, h, d) * 0.04));
      }
      case 'halfcylinder': {
        // A half disc (flat side down, round side up) extruded over `length`.
        const shape = new THREE.Shape();
        shape.moveTo(-r, 0);
        shape.absarc(0, 0, r, Math.PI, 0, true);
        return extrude(shape, num(part.length ?? part.depth, 1), bevelOf(r * 0.05));
      }
      case 'extrude': {
        // Any flat outline [[x, y], …] pulled out over depth; smooth: true curves it through its points
        // (a wing, a leaf, a car's side); bevel softens the edges.
        const outline = Array.isArray(part.outline) ? part.outline.filter((p) => Array.isArray(p) && p.length >= 2) : [];
        if (outline.length < 3) throw new Error('shape "extrude" needs outline: [[x, y], …] with at least 3 points');
        return extrude(outlineOf(outline, part.smooth === true), num(part.depth ?? part.length, 1), bevelOf(0));
      }
      default:
        // A box has soft edges, like a model made by hand; round: false makes it sharp.
        if (part.round === false || part.shape === 'roundbox') return new THREE.BoxGeometry(w, h, d);
        return solidGeometry(THREE, { ...part, shape: 'roundbox', radius: part.radius ?? Math.min(w, h, d) * 0.1, bevel: part.bevel ?? Math.min(w, h, d) * 0.06 });
    }
  }

  // The steps of J.build. With no `step` anywhere, each part is a step; otherwise a part
  // without one joins the step of the part before it. → [{ key, indices }], by step number.
  function groupSteps(parts) {
    const anyStep = parts.some((part) => part.step != null);
    const byKey = new Map();
    let key = 1;
    parts.forEach((part, i) => {
      if (anyStep) key = part.step != null ? num(part.step, key) : key;
      else key = i + 1;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(i);
    });
    return [...byKey].sort((a, b) => a[0] - b[0]).map(([k, indices]) => ({ key: k, indices }));
  }

  function makeJ(THREE) {
    const J = { palette: PALETTE, layout };

    J.material = (color, { opacity } = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1, transparent: opacity != null, opacity: opacity ?? 1 });

    J.geometry = (part) => {
      const r = part.radius ?? 1;
      const length = part.length ?? 1;
      switch (part.shape) {
        case 'disc':
        case 'cylinder':
          return new THREE.CylinderGeometry(r, r, length, 48, 1, part.open === true);
        case 'cone':
          // radiusEnd is at the end of the axis (the way the flow goes).
          return new THREE.CylinderGeometry(part.radiusEnd ?? r * 0.4, r, length, 48, 1, part.open === true);
        case 'sphere':
          return new THREE.SphereGeometry(r, 40, 24);
        case 'ring':
          return new THREE.TorusGeometry(r, part.tube ?? r * 0.15, 16, 48);
        default:
          return new THREE.BoxGeometry(length, part.height ?? r * 2, part.depth ?? r * 2);
      }
    };

    // Parts end to end along x (default) or y, each one a mesh with its name.
    // opts: { axis: 'x' | 'y', gap, labels: false }.
    J.assembly = (stage, parts, opts = {}) => {
      const axis = opts.axis === 'y' ? 'y' : 'x';
      const gap = opts.gap ?? 0.15;
      const centres = layout(parts.map(extent), gap);
      const group = new THREE.Group();
      const meshes = parts.map((part, i) => {
        const mesh = new THREE.Mesh(J.geometry(part), J.material(colorOf(part.color, i), { opacity: part.opacity }));
        const round = part.shape === 'disc' || part.shape === 'cylinder' || part.shape === 'cone';
        // Cylinders stand along y in three.js: lay them along the axis.
        if (round && axis === 'x') mesh.rotation.z = -Math.PI / 2;
        if (part.shape === 'ring') mesh.rotation[axis === 'x' ? 'y' : 'x'] = Math.PI / 2;
        if (!round && part.shape !== 'sphere' && part.shape !== 'ring' && axis === 'y') mesh.rotation.z = Math.PI / 2;
        mesh.position[axis] = centres[i];
        mesh.userData = { name: part.name ?? '', home: mesh.position.clone(), index: i };
        group.add(mesh);
        return mesh;
      });
      stage.add(group);
      if (opts.labels !== false) meshes.forEach((mesh, i) => parts[i].name && stage.label(mesh, parts[i].name));
      return { group, parts: meshes, axis };
    };

    // Pull the parts apart (amount 0 = together, 1 = well apart), smoothly.
    J.explode = (stage, assembly, amount = 1) => {
      for (const mesh of assembly.parts) {
        mesh.userData.target = mesh.userData.home.clone();
        mesh.userData.target[assembly.axis] *= 1 + amount * 0.8;
      }
      stage.onFrame((_t, dt) => {
        const k = Math.min(1, dt * 4);
        for (const mesh of assembly.parts) if (mesh.userData.target) mesh.position.lerp(mesh.userData.target, k);
      });
    };

    // Particles going from one point to another (air, data, current), their
    // colour changing on the way (cold to hot, raw to processed…).
    // opts: { count, colors: [from, to], speed (trips per second), size, spread }.
    J.flow = (stage, from, to, opts = {}) => {
      const count = opts.count ?? 40;
      const [c1, c2] = (opts.colors ?? ['sky', 'blush']).map((c, i) => new THREE.Color(colorOf(c, i)));
      const a = new THREE.Vector3(...from);
      const b = new THREE.Vector3(...to);
      const spread = opts.spread ?? 0.35;
      const geometry = new THREE.SphereGeometry(opts.size ?? 0.06, 8, 6);
      const dots = [];
      for (let i = 0; i < count; i++) {
        const dot = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: c1.clone() }));
        dot.userData = { phase: i / count, offset: new THREE.Vector3(0, (Math.sin(i * 12.9898) * 0.5) * spread * 2, (Math.cos(i * 78.233) * 0.5) * spread * 2) };
        stage.add(dot);
        dots.push(dot);
      }
      const speed = opts.speed ?? 0.25;
      const place = (t) => {
        for (const dot of dots) {
          const k = (dot.userData.phase + t * speed) % 1;
          dot.position.copy(a).lerp(b, k).add(dot.userData.offset);
          dot.material.color.copy(c1).lerp(c2, k);
        }
      };
      place(0);
      stage.onFrame((t) => place(t));
      return { dots };
    };

    // The general brick: any list of solids, placed where the model wants them, that
    // appear step by step (a part without a step of its own joins the one before it).
    //   J.build(stage, [
    //     { name: 'Base', shape: 'box', at: [0, 0, 0], size: [4, 0.4, 3], color: 'sky' },
    //     { name: 'Tower', shape: 'cylinder', at: [0, 1.4, 0], radius: 0.6, height: 2.4, step: 2 },
    //   ]);
    // part: { name, shape, at: [x, y, z], size | radius | height | length | tube | outline,
    //         rotate: [rx, ry, rz] in degrees, color, opacity, step, text, edges: false,
    //         anchor: [x, y, z] (where the label points, from the centre) }
    // opts: { steps: false (no steps), reveal: 'grow' | 'drop' | 'slide' | false, edges: false }
    // → { group, parts (one mesh per part, in order), steps, groups (one per step) }
    J.build = (stage, parts, opts = {}) => {
      if (!Array.isArray(parts) || !parts.length) throw new Error('J.build needs a list of parts: J.build(stage, [{ name, shape, at, size }])');
      // A scene with this many shapes is noise, not an explanation: the model simplifies and tries again.
      if (parts.length > MAX_PARTS) throw new Error(`J.build got ${parts.length} parts: too many. Keep at most 8 big simple shapes and merge the details (a car is a body, a cabin, wheels).`);
      const edges = opts.edges !== false;
      const meshes = parts.map((part, i) => {
        const geometry = solidGeometry(THREE, part ?? {});
        const mesh = new THREE.Mesh(geometry, J.material(colorOf(part.color, i), { opacity: part.opacity }));
        const [rx, ry, rz] = vec3(part.rotate);
        mesh.rotation.set(rx * DEG, ry * DEG, rz * DEG);
        mesh.userData = { name: part.name ?? '', index: i };
        // Thin ink edges: neighbours of the same colour stay readable, like a sketch.
        if (edges && part.edges !== false) {
          mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 40), new THREE.LineBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.22 })));
        }
        return mesh;
      });

      // One group per step, centred on its parts: that is the point it grows from.
      const rootGroup = new THREE.Group();
      const groups = groupSteps(parts).map(({ indices }) => {
        const centre = new THREE.Vector3();
        for (const i of indices) centre.add(new THREE.Vector3(...vec3(parts[i].at)));
        centre.divideScalar(indices.length);
        const group = new THREE.Group();
        group.position.copy(centre);
        for (const i of indices) {
          meshes[i].position.set(...vec3(parts[i].at)).sub(centre);
          group.add(meshes[i]);
        }
        const names = indices.map((i) => parts[i].name).filter(Boolean);
        const text = indices.map((i) => parts[i].text).find(Boolean) ?? names.join(', ');
        rootGroup.add(group);
        return { group, text };
      });
      stage.add(rootGroup);
      meshes.forEach((mesh, i) => parts[i].name && stage.label(mesh, parts[i].name, { at: Array.isArray(parts[i].anchor) ? vec3(parts[i].anchor) : null }));

      const steps = groups.map(({ group, text }) => ({ target: group, text }));
      if (opts.steps !== false) {
        stage.steps(steps, { build: opts.reveal !== false && steps.length > 1, reveal: typeof opts.reveal === 'string' ? opts.reveal : 'grow' });
      }
      return { group: rootGroup, parts: meshes, steps, groups: groups.map((g) => g.group) };
    };

    // Small movements that explain how a thing works. axis: 'x' | 'y' | 'z'.
    // J.spin: turns round (speed in turns per second); J.swing: rocks to and fro
    // (amplitude in degrees, speed in cycles per second); J.move: slides to and fro.
    J.spin = (stage, object, { axis = 'y', speed = 0.25 } = {}) => stage.onFrame((_t, dt) => (object.rotation[axis] += dt * speed * Math.PI * 2));
    J.swing = (stage, object, { axis = 'z', amplitude = 20, speed = 0.4 } = {}) => {
      const rest = object.rotation[axis];
      stage.onFrame((t) => (object.rotation[axis] = rest + Math.sin(t * speed * Math.PI * 2) * amplitude * DEG));
    };
    J.move = (stage, object, { axis = 'y', amount = 0.4, speed = 0.4 } = {}) => {
      const rest = object.position[axis];
      stage.onFrame((t) => (object.position[axis] = rest + Math.sin(t * speed * Math.PI * 2) * amount));
    };

    return J;
  }

  root.JudithBricks = { makeJ, layout, PALETTE, groupSteps };
})(globalThis);
