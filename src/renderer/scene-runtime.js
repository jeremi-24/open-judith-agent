// The stage a 3D scene is built on, and the runner that executes the model's
// code in the sandboxed scene frame. A classic script, like scene-bricks.js:
// the pure parts (createStage with a fake renderer) are tested in Node.
//
// The model's code receives (THREE, J, stage):
//   stage.add(object)              put something in the scene
//   stage.label(object, text)      a pill that follows the object
//   stage.onFrame((t, dt) => …)    animate (t, dt in seconds)
//   stage.focus(object)            turn the camera towards it
//   stage.steps([{ target, text, explode }])   the parts, one by one, moved by
//                                  the voice ("scene 2") or the arrows
(function (root) {
  const STEP_EVERY = 4.5; // seconds, when no voice drives the steps

  function createStage(THREE, { renderer, width = 320, height = 300, labelLayer = null } = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.05, 500);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d2ff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(4, 6, 5);
    scene.add(sun);

    const frames = [];
    const labels = [];
    const view = { target: new THREE.Vector3(), aim: new THREE.Vector3(), yaw: -0.35, pitch: 0.3, distance: 8, wanted: 8, spin: true };
    // The whole model: steps lean towards a part but keep it all in view.
    const whole = { centre: new THREE.Vector3(), distance: 8 };
    let stepList = [];
    let current = -1;
    let driven = false; // the voice moves the steps: no automatic advance
    let since = 0;
    let onStep = null;
    let errors = null;

    const stage = {
      scene,
      camera,
      labels,
      add(object) {
        scene.add(object);
        return object;
      },
      label(object, text) {
        const item = { object, text: String(text), el: null, number: labels.length + 1, side: labels.length % 2 ? 1 : -1 };
        if (labelLayer) {
          // A numbered dot; the full name when it is the current step (or
          // when the scene has no steps). Six names never fit in 320 px.
          item.el = labelLayer.ownerDocument.createElement('span');
          item.el.className = 'pill';
          item.el.dataset.number = String(item.number);
          item.el.dataset.text = item.text;
          item.el.textContent = item.text;
          labelLayer.append(item.el);
        }
        labels.push(item);
        return item;
      },
      onFrame(fn) {
        frames.push(fn);
      },
      focus(object) {
        const box = new THREE.Box3().setFromObject(object);
        if (box.isEmpty()) return;
        const centre = box.getCenter(new THREE.Vector3());
        view.aim.copy(whole.centre).lerp(centre, 0.4);
        view.wanted = whole.distance * 0.75;
      },
      // Fit the camera on everything in the scene.
      fit() {
        const box = new THREE.Box3();
        scene.traverse((o) => o.isMesh && box.expandByObject(o));
        if (box.isEmpty()) return;
        const radius = box.getSize(new THREE.Vector3()).length() / 2;
        // A little low, so the model sits above the step bar.
        box.getCenter(whole.centre).y -= radius * 0.12;
        whole.distance = Math.max(3, (radius / Math.tan((camera.fov * Math.PI) / 360)) * 0.85);
        view.aim.copy(whole.centre);
        view.target.copy(whole.centre);
        view.wanted = view.distance = whole.distance;
      },
      steps(list) {
        stepList = Array.isArray(list) ? list.filter(Boolean) : [];
        if (stepList.length) stage.go(0);
        return stepList.length;
      },
      // Show step i: highlight its part, dim the others, aim the camera.
      go(i) {
        if (!stepList.length) return -1;
        current = ((i % stepList.length) + stepList.length) % stepList.length;
        since = 0;
        const step = stepList[current];
        const targets = new Set(stepList.map((s) => s.target).filter(Boolean));
        for (const t of targets) {
          t.traverse?.((o) => {
            if (!o.material || !('emissive' in o.material)) return;
            o.material.emissive.setHex(t === step.target ? 0x3a2f80 : 0x000000);
            o.material.emissiveIntensity = t === step.target ? 0.55 : 0;
          });
        }
        for (const item of labels) item.active = item.object === step.target;
        if (step.target) stage.focus(step.target);
        else stage.fit();
        onStep?.(current, stepList.length, step.text ?? step.target?.userData?.name ?? '');
        return current;
      },
      // The voice reached "scene n" (1-based in the script).
      drive(n) {
        driven = true;
        return stage.go(n - 1);
      },
      get step() {
        return current;
      },
      get stepCount() {
        return stepList.length;
      },
      set onStep(fn) {
        onStep = fn;
      },
      set onError(fn) {
        errors = fn;
      },
      // Orbit with the pointer: dx, dy in pixels.
      orbit(dx, dy) {
        view.spin = false;
        view.yaw -= dx * 0.008;
        view.pitch = Math.min(1.4, Math.max(-1.4, view.pitch + dy * 0.008));
      },
      zoom(factor) {
        view.wanted = Math.min(200, Math.max(1, view.wanted * factor));
      },
      view,
      // One frame: t and dt in seconds.
      tick(t, dt) {
        for (let i = frames.length - 1; i >= 0; i--) {
          try {
            frames[i](t, dt);
          } catch (error) {
            frames.splice(i, 1); // a broken animation stops, the scene stays
            errors?.(error);
          }
        }
        if (stepList.length > 1 && !driven) {
          since += dt;
          if (since >= STEP_EVERY) stage.go(current + 1);
        }
        const k = Math.min(1, dt * 3);
        if (view.spin) view.yaw += dt * 0.15;
        view.target.lerp(view.aim, k);
        view.distance += (view.wanted - view.distance) * k;
        const c = Math.cos(view.pitch);
        camera.position.set(
          view.target.x + view.distance * c * Math.sin(view.yaw),
          view.target.y + view.distance * Math.sin(view.pitch),
          view.target.z + view.distance * c * Math.cos(view.yaw),
        );
        camera.lookAt(view.target);
        camera.updateMatrixWorld();
        placeLabels();
        renderer?.render(scene, camera);
      },
      resize(w, h) {
        width = w;
        height = h;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer?.setSize(w, h, false);
      },
    };

    const at = new THREE.Vector3();
    function placeLabels() {
      for (const item of labels) {
        item.object.getWorldPosition(at);
        at.project(camera);
        item.x = ((at.x + 1) / 2) * width;
        // Neighbours alternate above and below their part, so they do not overlap.
        item.y = ((1 - at.y) / 2) * height + item.side * 26;
        item.visible = at.z < 1;
        if (item.el) {
          item.el.style.transform = `translate(${item.x.toFixed(1)}px, ${item.y.toFixed(1)}px) translate(-50%, -50%)`;
          item.el.style.opacity = item.visible ? '' : '0';
          item.el.classList.toggle('active', Boolean(item.active));
          const short = stepList.length > 0 && !item.active;
          item.el.classList.toggle('dot', short);
          item.el.textContent = short ? item.el.dataset.number : item.el.dataset.text;
        }
      }
    }

    return stage;
  }

  // Runs the model's code on a fresh stage. → { ok: true } or { ok: false, error }.
  function runScene(THREE, J, stage, code) {
    try {
      // The code is the model's: it only gets these three names (the frame is
      // sandboxed, without network, and is thrown away after each scene).
      const build = new Function('THREE', 'J', 'stage', `"use strict";\n${code}`);
      build(THREE, J, stage);
    } catch (error) {
      return { ok: false, error: `${error.name}: ${error.message}` };
    }
    let meshes = 0;
    stage.scene.traverse((o) => o.isMesh && meshes++);
    if (!meshes) return { ok: false, error: 'The scene is empty: nothing was added with stage.add or J.assembly.' };
    stage.fit();
    if (stage.stepCount) stage.go(stage.step);
    return { ok: true, meshes };
  }

  root.JudithStage = { createStage, runScene, STEP_EVERY };
})(globalThis);
