// 멀티플레이: 로그인, 위치 공유, 다른 플레이어 표시, 왼쪽 고도 바
const CODE_VER = '20261029-1';   // 게임 코드 고칠 때마다 올리기 → 서버가 예전 탭을 자동 새로고침
const MP = { ready: false, you: null, players: [], ws: null, ver: -1, kicked: false, token: localStorage.getItem('jk_token') };
const LEVEL_H = 900, MAX_ALT = 43 * LEVEL_H;
const altOf = (lv, y) => lv * LEVEL_H + (LEVEL_H - y);

function poseImages() {
    return { idle: idleImage, squat: squatImage, jump: jumpImage, fall: fallImage, fallen: fallenImage,
             oof: oofImage, run1: run1Image, run2: run2Image, run3: run3Image };
}

MP.start = function (data) {
    MP.token = data.token;
    localStorage.setItem('jk_token', data.token);
    document.getElementById('login').style.display = 'none';
    const waitSetup = setInterval(() => {
        if (!player || !levels.length) return;
        clearInterval(waitSetup);
        MP.applyState(data.me);
        MP.ready = true;
        MP.connect();
    }, 100);
};

MP.applyState = function (me) {
    MP.ver = me.ver;
    MP.airAllowed = !!me.airJump;
    MP.setAir(MP.airOn);
    if (me.x === null) return;
    player.currentPos = createVector(me.x, me.y);
    player.currentSpeed = createVector(0, 0);
    player.playersDead = false;   // 원작 '죽음'(안 보이고 멈춤) 상태였어도 옮기면 풀리게
    player.currentLevelNo = me.lv;
    player.facingRight = me.fr;
    MP.hist = (me.hist || []).map(([lv, x, y, fr]) => ({ lv, x, y, fr }));
    if (!MP.hist.length) MP.hist = [{ lv: me.lv, x: me.x, y: me.y, fr: me.fr }];
};

// H: 공중점프 켜기/끄기 (권한 있는 계정만, 처음엔 꺼짐)
MP.airOn = false;
MP.setAir = function (on) {
    MP.airOn = MP.airAllowed && on;
    player.airJump = MP.airOn;
    const ind = document.getElementById('airInd'), btn = document.getElementById('pAir');
    ind.style.display = btn.style.display = MP.airAllowed ? '' : 'none';
    ind.textContent = '공중점프 ' + (MP.airOn ? 'ON' : 'OFF') + ' (H)';
    ind.style.color = MP.airOn ? '#ffd23f' : '#888';
    btn.classList.toggle('on', MP.airOn);
};
MP.toggleAir = () => { if (MP.ready && MP.airAllowed) MP.setAir(!MP.airOn); };

// R: 착지했던 곳으로 되돌아가기 (끼었을 때 탈출용).
// 마지막으로 서 있던 곳보다 확실히 낮은 곳으로만 감 → 떨어진 걸 되돌리거나 공중에서 눌러 올라가는 악용 불가
MP.hist = [];
MP.prevGround = false;
function recordLanding() {
    const g = player.isOnGround;
    if (g && !MP.prevGround) {
        const h = { lv: player.currentLevelNo, x: player.currentPos.x, y: player.currentPos.y, fr: player.facingRight };
        const last = MP.hist[MP.hist.length - 1];
        if (!last || last.lv !== h.lv || Math.abs(last.x - h.x) > 5 || Math.abs(last.y - h.y) > 5) MP.hist.push(h);
        if (MP.hist.length > 50) MP.hist.shift();
    }
    MP.prevGround = g;
}
MP.rewind = function () {
    if (!MP.ready) return;
    const last = MP.hist[MP.hist.length - 1];
    let cur = altOf(player.currentLevelNo, player.currentPos.y);
    if (last) cur = Math.min(cur, altOf(last.lv, last.y));   // 공중이면 마지막 착지 높이 기준
    for (let i = MP.hist.length - 1; i >= 0; i--) {
        const h = MP.hist[i];
        if (altOf(h.lv, h.y) >= cur - 5) continue;   // 같은 높이(갇힌 블록 안의 다른 지점 등)·더 높은 곳은 제외
        player.currentLevelNo = h.lv;
        player.currentPos = createVector(h.x, h.y);
        player.currentSpeed = createVector(0, 0);
        player.facingRight = h.fr;
        player.jumpHeld = false;
        player.jumpTimer = 0;
        player.hasFallen = false;
        MP.hist.length = i + 1;   // 다시 누르면 그 전 곳으로
        return;
    }
};

MP.connect = function () {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(MP.token)}&ver=${MP.ver}&cv=${CODE_VER}`);
    MP.ws = ws;
    ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.reload) {   // 예전 코드 → 새로고침 (30초 안에 반복되면 안내만)
            MP.kicked = true;
            const last = +sessionStorage.getItem('jk_reload') || 0;
            if (Date.now() - last > 30000) { sessionStorage.setItem('jk_reload', Date.now()); location.reload(); return; }
        }
        if (m.kicked) {
            MP.kicked = true;
            MP.ready = false;
            const box = document.getElementById('login');
            box.innerHTML = '<div style="background:#222;padding:24px;border-radius:10px;font-size:18px;text-align:center">다른 탭/기기에서 같은 계정으로 접속해서<br>여기는 연결이 끊겼어요.<br><br>새로고침하면 저장된 위치에서 이어서 해요.</div>';
            box.style.display = 'flex';
            return;
        }
        if (m.sync) { MP.applyState(m.sync); return; }
        MP.ver = m.ver;
        MP.you = m.you;
        MP.players = m.players;
        MP.updateBar();
    };
    ws.onclose = () => { if (!MP.kicked) setTimeout(MP.connect, 2000); };
};

setInterval(() => {
    if (MP.ready) recordLanding();
    if (!MP.ready || !MP.ws || MP.ws.readyState !== 1) return;
    const names = poseImages();
    const img = Object.keys(names).find(k => names[k] === player.lastImage) || 'idle';
    MP.ws.send(JSON.stringify({ x: player.currentPos.x, y: player.currentPos.y, lv: player.currentLevelNo,
                                fr: player.facingRight, img, g: player.isOnGround }));
}, 66);

// sketch.js draw()에서 translate(0, 50) 안쪽에서 호출
MP.drawGhosts = function () {
    const imgs = poseImages();
    for (const p of MP.players) {
        if (p.id === MP.you || p.lv !== player.currentLevelNo) continue;   // 나간 사람은 저장 위치에 흐리게
        const im = imgs[p.img] || idleImage;
        const dy = p.img === 'oof' ? -30 : (p.img === 'jump' || p.img === 'fall') ? -28 : -35;
        push();
        translate(p.x, p.y);
        tint(255, p.on ? 150 : 80);
        if (p.fr) image(im, -20, dy);
        else { push(); scale(-1, 1); image(im, -70, dy); pop(); }
        noTint();
        textSize(18);
        textStyle(BOLD);
        const tw = textWidth(p.name);
        noStroke();
        fill(0, 160);
        const ly = p.y < 70 ? 85 : -54;   // 화면 맨 위면 이름을 발밑에
        rect(25 - tw / 2 - 6, ly - 12, tw + 12, 24, 6);
        textAlign(CENTER, CENTER);
        fill(p.on ? 255 : 170);
        text(p.name, 25, ly);
        pop();
    }
};

MP.updateBar = function () {
    const bar = document.getElementById('marks');
    bar.textContent = '';
    let onlineCount = 0;
    const h = bar.parentElement.clientHeight;
    const list = MP.players.map(p => {
        const isMe = p.id === MP.you;
        const alt = isMe && MP.ready ? altOf(player.currentLevelNo, player.currentPos.y) : altOf(p.lv, p.y);
        return { p, isMe, px: Math.max(0, Math.min(1, alt / MAX_ALT)) * h };
    }).sort((a, b) => a.px - b.px);
    let last = -Infinity;
    for (const { p, isMe, px } of list) {
        if (p.on) onlineCount++;
        last = Math.max(px, last + 16);   // 같은 높이면 이름이 겹치지 않게 위로 쌓기
        const el = document.createElement('div');
        el.className = 'mark' + (isMe ? ' me' : p.on ? ' on' : ' off');
        el.style.bottom = last + 'px';
        el.textContent = p.name;
        el.title = `${p.name}: ${p.lv + 1}스테이지`;
        bar.appendChild(el);
    }
    document.getElementById('count').textContent = `접속 ${onlineCount}명`;
};

document.addEventListener('keydown', () => getAudioContext().resume());
// R/H는 e.code로 받음: 한글 입력 상태에선 p5의 key가 'R'/'H'로 안 들어옴
document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.repeat) return;
    if (e.code === 'KeyR') MP.rewind();
    if (e.code === 'KeyH') MP.toggleAir();
});

// 패드/폰용 터치 버튼: 왼쪽·오른쪽은 누르는 동안 이동, 점프는 누르는 동안 힘 모으고 떼면 점프
function bindPad(id, down, up) {
    const el = document.getElementById(id);
    el.addEventListener('pointerdown', e => {
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        getAudioContext().resume();
        if (!MP.ready) return;
        el.classList.add('on');
        down();
    });
    const release = e => {
        if (!el.classList.contains('on')) return;
        el.classList.remove('on');
        if (MP.ready) up();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('contextmenu', e => e.preventDefault());
}
// p5 옛 버전은 touchEnded가 없으면 모든 터치 떼기를 preventDefault 해서 아이패드에서 버튼/입력칸이 안 눌림 → 빈 함수로 막음
function touchEnded() {}

window.addEventListener('DOMContentLoaded', () => {
    const pad = document.getElementById('pad');
    if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) {
        pad.classList.add('show');
        // 키보드로 게임 키를 누르면 버튼 숨김, 다시 화면을 터치하면 보임
        document.addEventListener('keydown', e => {
            if (e.target.tagName !== 'INPUT' && [' ', 'ArrowLeft', 'ArrowRight'].includes(e.key)) pad.classList.remove('show');
        });
        document.addEventListener('touchstart', () => pad.classList.add('show'));
    }
    bindPad('pLeft', () => player.leftHeld = true, () => player.leftHeld = false);
    bindPad('pRight', () => player.rightHeld = true, () => player.rightHeld = false);
    bindPad('pBack', () => MP.rewind(), () => {});
    document.getElementById('pAir').addEventListener('pointerdown', e => { e.preventDefault(); MP.toggleAir(); });
    bindPad('pJump', () => player.jumpHeld = true, () => { player.jumpHeld = false; player.Jump(); });
});

window.addEventListener('DOMContentLoaded', () => {
    const ticks = document.getElementById('ticks');
    for (let lv = 0; lv <= 43; lv += 5) {
        const t = document.createElement('div');
        t.className = 'tick';
        t.style.bottom = (lv / 43 * 100) + '%';
        t.textContent = lv;
        ticks.appendChild(t);
    }

    const form = document.getElementById('loginForm'), err = document.getElementById('loginErr');
    form.onsubmit = async e => {
        e.preventDefault();
        err.textContent = '';
        const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: form.elements['name'].value, pw: form.elements['pw'].value }) });
        const d = await r.json();
        if (r.ok) MP.start(d); else err.textContent = typeof d.detail === 'string' ? d.detail : '닉네임 1~12자, 비밀번호 4자 이상';
    };
    if (MP.token) {
        fetch('/api/me?token=' + encodeURIComponent(MP.token)).then(r => r.ok ? r.json() : null)
            .then(d => d ? MP.start(d) : (document.getElementById('login').style.display = 'flex'));
    } else {
        document.getElementById('login').style.display = 'flex';
    }

    const fit = () => {
        const s = Math.min(innerWidth / 1200, innerHeight / 950);   // 창 크기에 맞춰 확대/축소, 가운데 정렬
        const x = (innerWidth - 1200 * s) / 2, y = (innerHeight - 950 * s) / 2;
        document.getElementById('wrap').style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    };
    addEventListener('resize', fit);
    fit();
});
