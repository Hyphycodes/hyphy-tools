/*
 * Kept apart from the client modules: the public layout (a server component) inlines this string.
 * The key must match HOME_KEY in ./prefs.
 */

/**
 * Runs before first paint (in the public layout): tells the page which mode it's in and whether
 * it's the home, so the mode's colors are there from the first frame and the first-visit version
 * the server sent stays hidden for the moment it takes the page to swap in the person's own.
 */
export const HOME_BOOT = `try{var h=document.documentElement,r=localStorage.getItem('hyphy.home.v1'),l=r&&JSON.parse(r).lens;if(l&&/^(everyday|create|work|all)$/.test(l))h.dataset.lens=l;if(/\\/tools\\/?$/.test(location.pathname))h.dataset.home=''}catch(e){}`;
