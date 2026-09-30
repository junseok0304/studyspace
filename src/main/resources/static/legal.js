const candidate = new URLSearchParams(location.search).get('return');
if (candidate === '/signup.html' || candidate === '/signup.html?social=kakao') {
  document.getElementById('legal-back').href = candidate;
}
