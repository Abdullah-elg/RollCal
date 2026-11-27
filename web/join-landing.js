// The join page's first job: show the invite code and open the app if it's
// installed. (Separate file so the page's content policy can forbid inline
// scripts.) Sets window.ROLLCAL_INVITE_CODE for join-guest.js.
(function () {
  // The code is the last part of the address (/join/ABCD1234); ?code= works too.
  var part = location.pathname.split('/').filter(Boolean)[1] || '';
  if (part === 'index.html') part = '';
  var code = (part || new URLSearchParams(location.search).get('code') || '')
    .toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  window.ROLLCAL_INVITE_CODE = code;
  if (code) {
    document.getElementById('code').textContent = code;
    document.getElementById('open').href = 'rollcal://join/' + code;
  } else {
    document.getElementById('code').style.display = 'none';
  }

  // A tapped rollcal.app link normally opens the app before this page
  // loads. It doesn't inside apps like Instagram, Facebook or Snapchat,
  // when the link is typed into the browser, or on Android before the
  // phone has checked the link belongs to RollCal. So hand it on:
  //  - Android: an intent link opens the app, or comes back here (with
  //    #web, so it doesn't try again) when the app isn't installed.
  //  - iPhone, inside those apps' browsers: try the app's own link. Not in
  //    Safari, where it would show an error to people without the app.
  var ua = navigator.userAgent;
  if (code && location.hash !== '#web') {
    if (/Android/i.test(ua)) {
      var back = location.href.split('#')[0] + '#web';
      location.replace('intent://join/' + code + '#Intent;scheme=rollcal;package=app.rollcal;' +
        'S.browser_fallback_url=' + encodeURIComponent(back) + ';end');
    } else if (/iPhone|iPad|iPod/i.test(ua) &&
               /FBAN|FBAV|Instagram|Snapchat|LinkedInApp|Line\/|musical_ly|BytedanceWebview|Twitter/i.test(ua)) {
      location.href = 'rollcal://join/' + code;
    }
  }
})();
