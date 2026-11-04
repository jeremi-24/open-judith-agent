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

    return J;
  }

  root.JudithBricks = { makeJ, layout, PALETTE };
})(globalThis);
