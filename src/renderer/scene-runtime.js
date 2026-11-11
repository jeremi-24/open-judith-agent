// The stage a 3D scene is built on, and the runner that executes the model's
// code in the sandboxed scene frame. A classic script, like scene-bricks.js:
// the pure parts (createStage with a fake renderer, layoutLabels) are tested in Node.
//
// The model's code receives (THREE, J, stage):
//   stage.add(object)              put something in the scene
//   stage.label(object, text)      a hand-written label with a leader line
//   stage.onFrame((t, dt) => …)    animate (t, dt in seconds)
//   stage.focus(object)            turn the camera towards it
//   stage.steps([{ target, text }], { build })   the parts, one by one, moved by the
//                                  voice ("scene 2") or the arrows; with build, a part
//                                  only appears when its step is reached
//   stage.reveal(object) / stage.hide(object)    make a part appear (animated) or vanish
(function (root) {
  const STEP_EVERY = 4.5; // seconds, when no voice drives the steps
  // A scene that builds up while the voice drives it, and whose voice stopped
  // before the last step: the rest appears by itself after this long.
  const FINISH_AFTER = 8;
  const REVEAL_SECONDS = 0.7;
  const LABEL_MARGIN = 10;
  const LABEL_GAP = 22;
  const MAX_LABELS = 6;

  const clamp01 = (n) => Math.min(1, Math.max(0, n));
  const easeOutCubic = (t) => 1 - (1 - t) ** 3;
  const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

  // Where the labels go: the margins, left or right of the model, each one at the
  // height of its part (pushed apart so two never overlap), with a leader line to
  // the part. Pure: items are { x, y, w } (the part's place on the view, the label's
  // width) and get { side, lx, ly, ex, ey } (the label's edge and where its line starts).
  function layoutLabels(items, width, height, { top = 16, bottom = height - 12, gap = LABEL_GAP, margin = LABEL_MARGIN } = {}) {
    for (const item of items) {
      // A part that crosses the middle changes side only well past it: no jumping.
      if (item.side === 'left' && item.x > width * 0.58) item.side = 'right';
      else if (item.side === 'right' && item.x < width * 0.42) item.side = 'left';
    }
    // A new label takes the nearer margin, unless that one is already fuller than the other.
    for (const item of items) {
      if (item.side) continue;
      const count = (side) => items.filter((other) => other.side === side).length;
      const near = item.x < width / 2 ? 'left' : 'right';
      const far = near === 'left' ? 'right' : 'left';
      item.side = count(near) > count(far) ? far : near;
    }
    const room = Math.max(1, Math.floor((bottom - top) / gap) + 1);
    for (const side of ['left', 'right']) {
      const other = side === 'left' ? 'right' : 'left';
      const mine = items.filter((item) => item.side === side);
      // More labels than the margin can hold: the ones nearest the other side move over.
      const extra = mine.length - room;
      if (extra > 0 && items.filter((item) => item.side === other).length + extra <= room) {
        mine
          .sort((a, b) => (side === 'left' ? b.x - a.x : a.x - b.x))
          .slice(0, extra)
          .forEach((item) => (item.side = other));
      }
    }
    for (const side of ['left', 'right']) {
      const column = items.filter((item) => item.side === side).sort((a, b) => a.y - b.y);
      column.forEach((item, i) => {
        item.ly = Math.min(bottom, Math.max(top, item.y));
        if (i) item.ly = Math.max(item.ly, column[i - 1].ly + gap);
      });
      // Pushed past the bottom: shift back up.
      for (let i = column.length - 1; i >= 0; i--) {
        const limit = i === column.length - 1 ? bottom : column[i + 1].ly - gap;
        column[i].ly = Math.min(column[i].ly, limit);
      }
      for (const item of column) {
        const w = item.w ?? 60;
        item.lx = side === 'left' ? margin : width - margin - w;
        // The line leaves the side of the text that faces its part; a part right under
        // (or over) the text is reached from below (or above), never through the words.
        const faces = side === 'left' ? item.x >= item.lx + w + 6 : item.x <= item.lx - 6;
        if (faces) {
          item.ex = side === 'left' ? item.lx + w + 6 : item.lx - 6;
          item.ey = item.ly;
        } else {
          item.ex = Math.min(item.lx + w, Math.max(item.lx, item.x));
          item.ey = item.ly + (item.y >= item.ly ? 9 : -9);
        }
      }
    }
    return items;
  }

  function createStage(THREE, { renderer, width = 320, height = 300, labelLayer = null, lineLayer = null } = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.05, 500);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d2ff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(4, 6, 5);
    scene.add(sun);

    const frames = [];
    const labels = [];
    const reveals = [];
    const view = { target: new THREE.Vector3(), aim: new THREE.Vector3(), yaw: -0.35, pitch: 0.3, distance: 8, wanted: 8, spin: true };
    // The whole model: steps lean towards a part but keep it all in view.
    const whole = { centre: new THREE.Vector3(), distance: 8 };
    let stepList = [];
    let current = -1;
    let driven = false; // the voice moves the steps: no automatic advance
    let building = false; // the parts appear as their step is reached
    let revealStyle = 'grow';
    let since = 0;
    let onStep = null;
    let errors = null;

    // A soft shadow under the whole model, so it stands on something instead of floating.
    // It needs a page to draw its texture: tests without a DOM skip it.
    let ground = null;
    function placeGround(box) {
      if (typeof document === 'undefined') return;
      if (!ground) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 128;
        const g = canvas.getContext('2d');
        const fade = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        fade.addColorStop(0, 'rgba(36, 32, 58, 0.30)');
        fade.addColorStop(0.55, 'rgba(36, 32, 58, 0.12)');
        fade.addColorStop(1, 'rgba(36, 32, 58, 0)');
        g.fillStyle = fade;
        g.fillRect(0, 0, 128, 128);
        const material = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false });
        ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
        ground.rotation.x = -Math.PI / 2;
        ground.userData.ground = true;
        scene.add(ground);
      }
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const span = Math.max(size.x, size.z) * 1.5;
      ground.position.set(centre.x, box.min.y - 0.02, centre.z);
      ground.scale.set(span, span, 1);
    }

    // ----- parts that appear -----
    // Where a part rests, remembered once, so that appearing and vanishing always end there.
    const restOf = (object) => (object.userData.rest ??= { position: object.position.clone(), scale: object.scale.clone() });
    const isShown = (object) => {
      for (let o = object; o; o = o.parent) if (!o.visible) return false;
      return true;
    };
    function applyReveal(item, k) {
      const { object, style, rest, offset } = item;
      const p = easeOutCubic(k);
      object.position.copy(rest.position);
      object.scale.copy(rest.scale);
      if (style === 'drop') {
        object.position.addScaledVector(offset, 1 - p);
        object.scale.multiplyScalar(0.85 + 0.15 * p);
      } else if (style === 'slide') {
        object.position.addScaledVector(offset, 1 - p);
      } else {
        object.scale.multiplyScalar(Math.max(0.001, easeOutBack(k)));
      }
    }
    function settle(object) {
      const at = reveals.findIndex((item) => item.object === object);
      if (at < 0) return;
      const [item] = reveals.splice(at, 1);
      object.position.copy(item.rest.position);
      object.scale.copy(item.rest.scale);
    }

    const stage = {
      scene,
      camera,
      labels,
      add(object) {
        scene.add(object);
        return object;
      },
      // opts.at: [x, y, z], where the leader line ends, from the object's centre.
      label(object, text, opts = {}) {
        const item = { object, text: String(text), number: labels.length + 1, offset: Array.isArray(opts?.at) ? new THREE.Vector3(...opts.at) : null, side: null, w: 0, el: null, mark: null };
        if (labelLayer) {
          const doc = labelLayer.ownerDocument;
          item.el = doc.createElement('span');
          item.el.className = 'tag';
          item.el.textContent = item.text;
          labelLayer.append(item.el);
          if (lineLayer) {
            const ns = 'http://www.w3.org/2000/svg';
            item.mark = doc.createElementNS(ns, 'g');
            item.mark.setAttribute('class', 'mark');
            item.path = doc.createElementNS(ns, 'path');
            item.path.setAttribute('class', 'leader');
            item.path.setAttribute('pathLength', '1');
            item.dot = doc.createElementNS(ns, 'circle');
            item.dot.setAttribute('class', 'dot');
            item.dot.setAttribute('r', '3.5');
            item.mark.append(item.path, item.dot);
            lineLayer.append(item.mark);
          }
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
        // A model that builds up stays whole in view (its last parts are still to come);
        // the others lean in towards the part.
        view.aim.copy(whole.centre).lerp(centre, building ? 0.15 : 0.4);
        view.wanted = whole.distance * (building ? 0.95 : 0.75);
      },
      // Fit the camera on everything in the scene (hidden parts count: the whole
      // model is in view from the first step to the last).
      fit() {
        // Parts sit inside groups that have not been drawn yet: their world places are not known until now.
        scene.updateMatrixWorld(true);
        const box = new THREE.Box3();
        scene.traverse((o) => o.isMesh && !o.userData.ground && box.expandByObject(o));
        if (box.isEmpty()) return;
        placeGround(box);
        const radius = box.getSize(new THREE.Vector3()).length() / 2;
        // A little low, so the model sits above the step bar.
        box.getCenter(whole.centre).y -= radius * 0.12;
        // With labels, the margins are theirs: the model keeps to the middle.
        const room = labels.length ? 1.6 : 1;
        // A tall view is narrower than it is high: the width is what has to fit.
        const half = Math.tan((camera.fov * Math.PI) / 360) * Math.min(1, camera.aspect);
        whole.distance = Math.max(3, (radius / half) * 0.85 * room);
        view.aim.copy(whole.centre);
        view.target.copy(whole.centre);
        view.wanted = view.distance = whole.distance;
      },
      // A part appears: it grows (or drops, or slides) into place. style: 'grow' | 'drop' | 'slide'.
      reveal(object, { style = revealStyle, duration = REVEAL_SECONDS } = {}) {
        if (object.visible && object.userData.shown !== false) return false; // already there
        object.userData.shown = true;
        object.visible = true;
        settle(object);
        const rest = restOf(object);
        const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3()).length() || 1;
        const offset = style === 'slide' ? new THREE.Vector3(size * 0.9, 0, 0) : new THREE.Vector3(0, size * 0.9, 0);
        const item = { object, style, rest, offset, duration: Math.max(0.05, duration), t: 0 };
        reveals.push(item);
        applyReveal(item, 0); // no flash at full size before the first frame
        return true;
      },
      hide(object) {
        settle(object);
        restOf(object);
        object.userData.shown = false;
        object.visible = false;
      },
      steps(list, opts = {}) {
        stepList = Array.isArray(list) ? list.filter(Boolean) : [];
        building = Boolean(opts?.build) && stepList.length > 1;
        if (typeof opts?.reveal === 'string') revealStyle = opts.reveal;
        if (building) for (const step of stepList) step.target && stage.hide(step.target);
        if (stepList.length) stage.go(0);
        return stepList.length;
      },
      // Show step i: highlight its part, dim the others, aim the camera.
      go(i) {
        if (!stepList.length) return -1;
        current = ((i % stepList.length) + stepList.length) % stepList.length;
        since = 0;
        const step = stepList[current];
        if (building) {
          // The model is built up to this step: earlier parts are there, later ones are not yet.
          stepList.forEach((s, k) => {
            if (!s.target) return;
            if (k <= current) stage.reveal(s.target);
            else stage.hide(s.target);
          });
        }
        const targets = new Set(stepList.map((s) => s.target).filter(Boolean));
        for (const t of targets) {
          t.traverse?.((o) => {
            if (!o.material || !('emissive' in o.material)) return;
            o.material.emissive.setHex(t === step.target ? 0x3a2f80 : 0x000000);
            o.material.emissiveIntensity = t === step.target ? 0.55 : 0;
          });
        }
        for (const item of labels) {
          let own = item.object;
          while (own && !targets.has(own)) own = own.parent;
          item.active = Boolean(step.target) && (item.object === step.target || own === step.target);
        }
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
        for (let i = reveals.length - 1; i >= 0; i--) {
          const item = reveals[i];
          item.t += dt;
          const k = clamp01(item.t / item.duration);
          if (k >= 1) settle(item.object);
          else applyReveal(item, k);
        }
        for (let i = frames.length - 1; i >= 0; i--) {
          try {
            frames[i](t, dt);
          } catch (error) {
            frames.splice(i, 1); // a broken animation stops, the scene stays
            errors?.(error);
          }
        }
        if (stepList.length > 1) {
          since += dt;
          const last = stepList.length - 1;
          // A built-up model stays whole at the end; the others go round again.
          if (!driven && !(building && current >= last) && since >= STEP_EVERY) stage.go(current + 1);
          // The voice stopped before the last step: the rest of the model comes by itself.
          else if (driven && building && current < last && since >= FINISH_AFTER) stage.go(current + 1);
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
        if (item.offset) item.object.localToWorld(at.copy(item.offset));
        else item.object.getWorldPosition(at);
        at.project(camera);
        item.x = ((at.x + 1) / 2) * width;
        item.y = ((1 - at.y) / 2) * height;
        item.visible = at.z < 1 && isShown(item.object);
        // The width of the written label (measured once it is on the page).
        if (item.el && !item.w) item.w = Math.min(item.el.offsetWidth || item.text.length * 7, width * 0.4);
        if (!item.w) item.w = Math.min(item.text.length * 7, width * 0.4);
      }
      // Never more than a handful of written labels: the current ones first, then the latest.
      const shown = labels
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.visible)
        .sort((a, b) => Number(Boolean(b.item.active)) - Number(Boolean(a.item.active)) || b.index - a.index)
        .slice(0, MAX_LABELS)
        .map(({ item }) => item);
      for (const item of labels) item.drawn = shown.includes(item);
      // The step bar takes the bottom of the view.
      layoutLabels(shown, width, height, { bottom: height - (stepList.length ? 52 : 14) });
      labels.forEach((item, index) => {
        if (!item.el) return;
        const on = Boolean(item.drawn);
        item.el.classList.toggle('on', on);
        item.el.classList.toggle('active', on && Boolean(item.active));
        item.el.classList.toggle('right', on && item.side === 'right');
        if (!item.mark) return;
        item.mark.classList.toggle('on', on);
        item.mark.classList.toggle('active', on && Boolean(item.active));
        if (!on) return;
        item.el.style.transform = `translate(${item.lx.toFixed(1)}px, ${item.ly.toFixed(1)}px) translateY(-50%)`;
        // A slightly bent stroke, as drawn by hand; each one bends its own way.
        const bend = (index % 2 ? 1 : -1) * 5;
        const mx = (item.ex + item.x) / 2;
        const my = (item.ey + item.y) / 2 + bend;
        item.path.setAttribute('d', `M${item.ex.toFixed(1)} ${item.ey.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${item.x.toFixed(1)} ${item.y.toFixed(1)}`);
        item.dot.setAttribute('cx', item.x.toFixed(1));
        item.dot.setAttribute('cy', item.y.toFixed(1));
      });
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
    if (!meshes) return { ok: false, error: 'The scene is empty: nothing was added with stage.add, J.build or J.assembly.' };
    stage.fit();
    if (stage.stepCount) stage.go(stage.step);
    return { ok: true, meshes };
  }

  root.JudithStage = { createStage, runScene, layoutLabels, STEP_EVERY, FINISH_AFTER };
})(globalThis);
