/* 모두카피 PDF 도구 시작 화면: 작업 이름 검색(타일 필터). 스크립트가 꺼져 있어도 모든 타일은 그대로 보입니다. */
(function () {
  'use strict';
  var input = document.getElementById('q');
  if (!input) return;
  var form = document.getElementById('find');
  var clear = document.getElementById('q-clear');
  var status = document.getElementById('find-status');
  var none = document.getElementById('none');
  var pop = document.getElementById('pop');
  var groups = [].slice.call(document.querySelectorAll('#tools .grp'));
  var items = [].slice.call(document.querySelectorAll('#tools .tiles > li'));

  function norm(s) { return String(s || '').toLowerCase().replace(/[\s·→>\-_.,()\[\]]+/g, ''); }
  items.forEach(function (li) { li._k = norm(li.getAttribute('data-k') + ' ' + li.textContent); });

  function apply() {
    var words = input.value.toLowerCase().split(/\s+/).map(norm).filter(Boolean);
    var finding = words.length > 0;
    var shown = 0;
    items.forEach(function (li) {
      var ok = words.every(function (w) { return li._k.indexOf(w) !== -1; });
      li.hidden = !ok;
      if (ok) shown++;
    });
    groups.forEach(function (g) { g.hidden = !g.querySelector('.tiles > li:not([hidden])'); });
    pop.hidden = finding;
    clear.hidden = !finding;
    none.hidden = shown > 0;
    document.body.classList.toggle('is-finding', finding);
    status.textContent = !finding ? '' : shown ? '작업 ' + shown + '개를 찾았습니다.' : '찾는 작업이 없습니다.';
  }
  function reset() { input.value = ''; apply(); input.focus(); }

  input.addEventListener('input', apply);
  input.addEventListener('keydown', function (e) { if (e.key === 'Escape' && input.value) { e.preventDefault(); reset(); } });
  clear.addEventListener('click', reset);
  document.getElementById('none-clear').addEventListener('click', reset);
  // Enter: 누를 수 있는 첫 결과로 초점 이동(바로 이동하지 않아 잘못 들어가는 일을 막음)
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var first = document.querySelector('#tools .tiles > li:not([hidden]) a.tile');
    if (first) first.focus();
  });
  // 주소의 ?q= 로 미리 찾기 (쇼핑몰에서 넘겨줄 때 사용)
  try {
    var q = new URLSearchParams(location.search).get('q');
    if (q) { input.value = q.slice(0, 40); }
  } catch (err) {}
  apply();
})();
