gsap.registerPlugin(ScrollTrigger, CustomEase);

let scroll;
let transitionOffset = 450;

CustomEase.create("animation-nav", ".3, 0, .3, 1");

initPageTransitions();

// Animation - Page Loader
function initLoaderHome() { 

   var offset = 10;
   if ($(window).width() < 1024) {offset = 15}
   if ($(window).width() < 720) {offset = 20}
   if ($(window).width() < 540) {offset = 25}

   var offsetTop = 45 + "%";
   if ($(window).width() < 1024) {offsetTop = 60 + "%"}

   var offsetPositive = (50 - offset) + "%";
   var offsetNegative = (50 + offset) + "%";

   var tl = gsap.timeline();

   tl.set("html", { 
      cursor: "wait"
   }, 0);

   tl.set(".default-header .col-row", { 
      rotate: 0.001,
      opacity: 0,
      y: "1em",
      filter: "blur(0.25em)",
      scale: 0.975
   }, 0);

   tl.set("html", { 
      cursor: "auto",
   }, 0);

   tl.set("body header", { 
      autoAlpha: 0
   }, 0);
   
   tl.set(".section", { 
      autoAlpha: 0,
   }, 0);

   tl.set(".section.section-home-header", { 
      autoAlpha: 1,
   }, 0.8);

   tl.set(".section", { 
      autoAlpha: 1,
   }, 0.8);
   
   tl.set(".section-home-header .background-media", { 
      scale: 1,
      rotate: 0.001
   }, 0);

   tl.set(".loading-container .loading-screen", { 
      backgroundColor: "transparent"
   }, 0);

   tl.set(".section-home-header", {
      clipPath: "polygon(" + offsetPositive + " " + offsetTop +", " + offsetNegative + " " + offsetTop + ", " + offsetNegative + " 100%, " + offsetPositive + " 100%)"
   }, 0);

   tl.set(".loading-logo svg", {
      yPercent: 0,
      rotate: 0.001,
   }, 0);

   tl.from(".section-home-header", {
      yPercent: 50,
      rotate: 0.001,
      duration: 2,
      ease: "Expo.easeInOut",
   }, 0);

   tl.to(".loading-logo", {
      top: "35%",
      rotate: 0.001,
      duration: 2,
      ease: "Expo.easeInOut",
   }, 0);

   tl.to(".section-home-header", {
      duration: 2,
      ease: "Expo.easeInOut",
      clipPath: "polygon(-1% -1%, 101% -1%, 101% 101%, -1% 101%)",
      clearProps: "all",
   }, 1.8);

   tl.to(".loading-logo svg", {
      yPercent: -100,
      rotate: 0.001,
      duration: 0.9,
      ease: "Expo.easeIn"
   }, 1.8);

   tl.to(".loading-logo", {
      top: "5%",
      rotate: 0.001,
      duration: 2,
      ease: "Expo.easeInOut"
   }, 1.8);

   tl.set(".loading-screen", { 
      autoAlpha: 0,
   }, 3.8);

   tl.to(".section-home-header .background-media", {
      duration: 2,
      ease: "Expo.easeInOut",
      scale: 1,
      rotate: 0.001,
      clearProps: "all",
   }, 1.8);

   tl.to(".loading-logo", {
      opacity: 0,
      duration: 0.4,
      ease: "Expo.easeInOut"
   }, 2.6);

   tl.from(".section-home-header .container", {
      duration: 2,
      ease: "Expo.easeOut",
      yPercent: 10,
      clearProps: "all",
   }, 2.6);

   tl.to("body header", {
      duration: 1.4,
      ease: "Expo.easeOut",
      autoAlpha: 1,
      clearProps: "all"
   }, 2.8);

   tl.call(function() {
      scroll.stop();
      scroll.scrollTo(top,{immediate: true, force: true, lock: true, duration: 0.0166});
      window.scrollTo(0, 0);
   }, null, 0);

   tl.call(function() {
      initMews();
      scroll.scrollTo(top,{immediate: true, force: true, lock: true, duration: 0.0166});
      window.scrollTo(0, 0);
   }, null, 0.1);

   tl.call(function() {
      scroll.scrollTo(top,{immediate: true, force: true, lock: true, duration: 0.0166});
      window.scrollTo(0, 0);
   }, null, 0.2);

   tl.call(function() {
      scroll.scrollTo(top,{immediate: true, force: true, lock: true, duration: 0.0166});
      window.scrollTo(0, 0);
   }, null, 0.5);

   tl.call(function() {
      scroll.scrollTo(top,{immediate: true, force: true, lock: true, duration: 0.0166});
      window.scrollTo(0, 0);
   }, null, 1);

   tl.call(function() {
      pageTransitionOut();
   }, null, 2.4);

   tl.call(function() {
      initGetTripadvisorNumber();
   }, null, 2);

}

// Animation - Page Loader
function initLoader() { 

   var tl = gsap.timeline();

   tl.set("html", { 
      cursor: "wait"
   });

   tl.to(".loading-screen", {
      duration: .8,
      autoAlpha: 0,
      ease: "animation-nav"
   }, 1);

   tl.to(".loading-logo svg", {
      yPercent: -100,
      rotate: 0.001,
      duration: 1.2,
      ease: "Expo.easeInOut",
   }, 0.2);

   tl.set("html", { 
      cursor: "auto",
   });

   tl.set(".transition-screen", {
      autoAlpha: 1
   }, 0);

   tl.to(".transition-screen", {
      duration: .8,
      autoAlpha: 0,
      ease: "animation-nav"
   }, 0.1);

   tl.call(function() {
      scroll.stop();
   }, null, 0);

   tl.call(function() {
      initMews();
   }, null, 0.1);

   tl.call(function() {
      pageTransitionOut();
   }, null, 0.7);

   tl.call(function() {
      initGetTripadvisorNumber();
   }, null, 2);

}

// Animation - Page Leave
function pageTransitionIn() {
	var tl = gsap.timeline();

   if(document.querySelector('.lorem-ipsum')) {}

   tl.to(".transition-screen", {
      duration: .4,
      autoAlpha: 1,
      ease: "animation-nav"
   }, 0);
   
   tl.to(".transition-screen", {
      duration: .8,
      autoAlpha: 0,
      ease: "animation-nav"
   }, 0.5);

   // Circle load

   var circleLength = document.querySelector('.loading-circle svg circle').getTotalLength();

   tl.set(".loading-circle svg circle", { 
      strokeDashoffset: circleLength * 3,
      strokeDasharray: circleLength + 2,
      opacity: 1,
   }, 0);

   tl.set(".loading-circle svg", { 
      rotate: 0,
      opacity: 1
   }, 0);

   tl.to(".loading-circle svg circle", { 
      autoAlpha: 1,
      duration: 0.7,
      ease: "Power1.easeIn",
   }, 0);

   tl.to(".loading-circle svg", { 
      rotate: 360,
      duration: 1.3,
      ease: "none",
   }, 0);

   tl.to(".loading-circle svg circle", { 
      autoAlpha: 1,
      duration: 0.65,
      ease: "Power1.easeIn",
      strokeDashoffset: circleLength * 2
   }, 0);

   tl.to(".loading-circle svg circle", { 
      autoAlpha: 1,
      duration: 0.65,
      ease: "Power1.easeOut",
      strokeDashoffset: circleLength * 1
   }, 0.7);

   tl.to(".loading-circle svg", { 
      duration: 0.01,
      opacity: 0,
      ease: "none"
   }, 1.25);

   // Call

   tl.call(function() {
      scroll.stop();
      $('[data-page-transition]').attr('data-page-transition', 'active');
      $('[data-links-no-hover]').attr('data-links-no-hover', 'active');
   }, null, 0);

   tl.call(function() {
      $('[data-page-transition]').attr('data-page-transition', 'not-active');
   }, null, 0.5);

   tl.call(function() {
      $('[data-links-no-hover]').attr('data-links-no-hover', 'not-active');
   }, null, 0.55);


}

// Animation - Page Enter
function pageTransitionOut() {
	var tl = gsap.timeline();
  
   tl.call(function() {
      scroll.start();
   }, null, 0);

   tl.set(".default-header .col-row, .default-header + .section", { 
      rotate: 0.001,
      opacity: 0,
      y: "1em",
      filter: "blur(0.25em)",
      scale: 0.975
   }, 0);

   tl.to(".default-header .col-row, .default-header + .section", {
      duration: 1.4,
      rotate: 0.001,
      opacity: 1,
      y: "0em",
      ease: "Expo.easeOut",
      stagger: 0.1,
      scale: 1
   }, 0.2);

   tl.to(".default-header .col-row, .default-header + .section", {
      duration: 2,
      ease: "Expo.easeOut",
      clearProps: "all",
      stagger: 0.1,
      filter: "blur(0em)",
      scale: 1
   }, 0.2);
}

function initPageTransitions() {

   // Reset scroll on page next
   history.scrollRestoration = "manual";

   barba.hooks.afterEnter(() => {
      window.scrollTo(0, 0);
      ScrollTrigger.refresh();
   });
   
   barba.hooks.leave(() => {
      initBasicFunctions();
   });

   // Functions Before
   function initResetDataBefore() {
      $('[data-navigation-status]').attr('data-navigation-status', 'not-active');
      $('[data-credits-status]').attr('data-credits-status', 'not-active');
      $('[data-whatsapp-status]').attr('data-whatsapp-status', 'not-active');
      $('[data-nav-image-status]').attr('data-nav-image-status', 'not-active');
      $('[data-cursor-bubble]').attr('data-cursor-bubble', 'not-active');
   }

   // Functions After
   function initResetDataAfter() {
      $('[data-navigation-status]').attr('data-navigation-status', 'not-active');
      $('[data-credits-status]').attr('data-credits-status', 'not-active');
      $('[data-whatsapp-status]').attr('data-whatsapp-status', 'not-active');
      $('[data-scrolling-direction]').attr('data-scrolling-direction', 'down');
      $('[data-scrolling-started]').attr('data-scrolling-started', 'false');
      $('[data-nav-image-status]').attr('data-nav-image-status', 'not-active');
      $('[data-cursor-init]').attr('data-cursor-init', 'false');
   }

   barba.init({
      sync: true,
      debug: true,
      timeout:7000,
      transitions: [{
         name: 'load-home',
         from: {

         },
         to: {
            namespace: ['home']
         },
         once(data) {
            initSmoothScroll(data.next.container);
            initScript();
            initLoaderHome();
         },
         async leave(data) {
            pageTransitionIn(data.current);
            initResetDataBefore();
            await delay(transitionOffset);
            initBarbaNavUpdate(data);
            initResetDataAfter();
            scroll.destroy();
            data.current.container.remove();
         },
         async enter(data) {
            pageTransitionOut(data.next);
         },
         async beforeEnter(data) {
            ScrollTrigger.getAll().forEach(t => t.kill());
            initSmoothScroll(data.next.container);
            initScript(); 
         }
      },{
         name: 'self',
         async leave(data) {
            pageTransitionIn(data.current);
            initResetDataBefore();
            await delay(transitionOffset);
            initBarbaNavUpdate(data);
            initResetDataAfter();
            scroll.destroy();
            data.current.container.remove();
         },
         async enter(data) {
            pageTransitionOut(data.next);
         },
         async beforeEnter(data) {
            ScrollTrigger.getAll().forEach(t => t.kill());
            initSmoothScroll(data.next.container);
            initScript(); 
         }
      },{
         name: 'default',
         once(data) {
            initSmoothScroll(data.next.container);
            initScript();
            initLoader();
         },
         async leave(data) {
            pageTransitionIn(data.current);
            initResetDataBefore();
            await delay(transitionOffset);
            initBarbaNavUpdate(data);
            initResetDataAfter();
            scroll.destroy();
            data.current.container.remove();
         },
         async enter(data) {
            pageTransitionOut(data.next);
         },
         async beforeEnter(data) {
            ScrollTrigger.getAll().forEach(t => t.kill());
            initSmoothScroll(data.next.container);
            initScript(); 
         }
      }]
   });

   function initSmoothScroll(container) {

      // Lenis: https://github.com/studio-freight/lenis
      initLenis();
     
      function raf(time) {
         scroll.raf(time);
         requestAnimationFrame(raf);
      }
      requestAnimationFrame(raf);
      
      ScrollTrigger.refresh();
   }  
}  

function initLenis() {
   scroll = new Lenis({
      duration: 1
   });

   scroll.on('scroll', ScrollTrigger.update);

   gsap.ticker.add((time)=>{
      scroll.raf(time * 1000);
   });
   
   gsap.ticker.lagSmoothing(0);
}

// Don't touch
function delay(n) {
	n = n || 2000;
	return new Promise((done) => {
		setTimeout(() => {
			done();
		}, n);
	});
}

/**
 * Fire all scripts on page load
 */
function initScript() {
   initUpdateTripadvisorNumber();
   initCheckWindowHeight();
   initBasicFunctions();
   initLazyLoad();
   initScrollTriggerPlayVideoInview();
   initLenisCheckScrollUpDown();
   initScrollToAnchorLenis();
   initScrollTriggerDataBackground();
   initScrollTriggerParallaxScroll();
   initScrolltriggerAnimations();
   initSwiperSlider();
   initCustomCursor();
}

/**
 * Update number Tripadvisor
 */
let tripadvisorReviews = '1,230 reviews';
let tripadvisorStars = 'bubble_50';

// Step 1: Get the number from variable
function initUpdateTripadvisorNumber() {
   $('.tripadvisor-reviews-count').text(tripadvisorReviews);
}
// Step 2: Get the number from tripadvisor embed in .floating-elements
function initGetTripadvisorNumber() {
   var tripadvisorElement = $('.cdsRating');
   var tripadvisorElementReviews = tripadvisorElement.find('br').next().text();
   var tripadvisorElementStars = tripadvisorElement.find('.ui_bubble_rating').attr('class');
   tripadvisorElementStars = tripadvisorElementStars.replace('ui_bubble_rating ', '');
   // Step 3: Update number with new count
   tripadvisorReviews = tripadvisorElementReviews;
   tripadvisorStars = tripadvisorElementStars;
   $('.tripadvisor-reviews-count').text(tripadvisorElementReviews);
   $('.tripadvisor-reviews-stars').attr('data-tripadvisor-stars', tripadvisorElementStars);
}

/**
 * Barba Update Links outside Main on page Transition
 */
function initBarbaNavUpdate(data) {

   const updateItems = $(data.next.html).find('[data-barba-update]');

   $('[data-barba-update]').each(function(index) {
      if($(updateItems[index]).get(0)) {
         const newLinkStatus = $(updateItems[index]).get(0).getAttribute('data-link-status');
         $(this).attr('data-link-status', newLinkStatus);
      }
   });

   const updateItemsMews = $(data.next.html).find('[data-mews-update]');

   $('[data-mews-update]').each(function(index) {
      if($(updateItemsMews[index]).get(0)) {
         const newMewstatus = $(updateItemsMews[index]).get(0).getAttribute('data-mews-voucher');
         $(this).attr('data-mews-voucher', newMewstatus);
      }
   });
}

/**
 * Window Inner Height Check
 */
function initCheckWindowHeight() {
   // https://css-tricks.com/the-trick-to-viewport-units-on-mobile/
   let vh = window.innerHeight * 0.01;
   document.documentElement.style.setProperty('--vh', `${vh}px`);
}

/**
 * Basic Functions
 */
function initBasicFunctions() {
   
   // Toggle Navigation
   $('[data-navigation-toggle="toggle"]').click(function(){
      if ($('[data-navigation-status]').attr('data-navigation-status') == 'not-active') {
         $('[data-navigation-status]').attr('data-navigation-status', 'active');
         scroll.stop();
      } else {
         $('[data-navigation-status]').attr('data-navigation-status', 'not-active');
         scroll.start();
      }
   });
   
   // Close Navigation
   $('[data-navigation-toggle="close"]').click(function(){
      $('[data-navigation-status]').attr('data-navigation-status', 'not-active');
      scroll.start();
   });

   // Key ESC - Close Navigation
   $(document).keydown(function(e){
      if(e.keyCode == 27) {
         if ($('[data-navigation-status]').attr('data-navigation-status') == 'active') {
            $('[data-navigation-status]').attr('data-navigation-status', 'not-active');
            scroll.start();
         } 
      }
   });

   // Cycle Images Credits
   let cycleImages = $('.credits-box .credits-images li');
   let cyclePrev;
   let cycleCurrent = 0;
   let imageCycle;

   function resetCycle() {
      setTimeout(function() {
         cyclePrev = 0;
         cycleCurrent = 0;
         cycleImages.removeClass('active');
         cycleImages[cycleCurrent].classList.add("active");
      }, 800);
   }

   function cycleThroughImages() {
      cyclePrev = cycleCurrent;
      cycleCurrent++;
      if (cycleCurrent > cycleImages.length - 1) cycleCurrent = 0;
      cycleImages[cyclePrev].classList.remove("active");
      cycleImages[cyclePrev].classList.add("prev-active");
      cycleImages[cycleCurrent].classList.add("active");
      setTimeout(function() {
         cycleImages[cyclePrev].classList.remove("prev-active");
      }, 1000);
   }

   // Toggle Credits
   $('[data-credits-toggle="toggle"]').click(function(){
      if ($('[data-credits-status]').attr('data-credits-status') == 'not-active') {
         $('[data-credits-status]').attr('data-credits-status', 'active');
         scroll.stop();
         imageCycle = setInterval(cycleThroughImages, 1400);
      } else {
         $('[data-credits-status]').attr('data-credits-status', 'not-active');
         scroll.start();
         clearInterval(imageCycle);
         resetCycle();
      }
   });

   // Close Credits
   $('[data-credits-toggle="close"]').click(function(){
      $('[data-credits-status]').attr('data-credits-status', 'not-active');
      scroll.start();
      clearInterval(imageCycle);
      resetCycle();
   });

   // Key ESC - Close Credits
   $(document).keydown(function(e){
      if(e.keyCode == 27) {
         if ($('[data-credits-status]').attr('data-credits-status') == 'active') {
            $('[data-credits-status]').attr('data-credits-status', 'not-active');
            scroll.start();
            clearInterval(imageCycle);
            resetCycle();
         } 
      }
   });

   // Navigation Images

   $('.col-row-mobile-nav [data-nav-image-id]').on('mouseenter', function() {
      var navImageID = $(this).attr('data-nav-image-id');
      $('[data-nav-image-group]').find('[data-nav-image-id="' + navImageID + '"]').attr('data-nav-image-status', 'active').siblings().attr('data-nav-image-status', 'not-active');
   });

   $('.col-row-mobile-nav [data-nav-image-id]').on('mouseleave', function() {
      $('[data-nav-image-group]').find('[data-nav-image-id]').attr('data-nav-image-status', 'not-active');
   });

   
   // Toggle Whatsapp (Desktop)
   $('[data-whatsapp-toggle="toggle"]').click(function(){
      if ($('[data-whatsapp-status]').attr('data-whatsapp-status') == 'not-active') {
         $('[data-whatsapp-status]').attr('data-whatsapp-status', 'active');
      } else {
         $('[data-whatsapp-status]').attr('data-whatsapp-status', 'not-active');
      }
   });
   
   // Close Navigation
   $('[data-whatsapp-toggle="close"]').click(function(){
      $('[data-whatsapp-status]').attr('data-whatsapp-status', 'not-active');
   });

   // Key ESC - Close Navigation
   $(document).keydown(function(e){
      if(e.keyCode == 27) {
         if ($('[data-whatsapp-status]').attr('data-whatsapp-status') == 'active') {
            $('[data-whatsapp-status]').attr('data-whatsapp-status', 'not-active');
         } 
      }
   });

   // Filter
   $('[data-filter-section]').each(function () {

      var filterSection = $(this);
      var filterGroup = $('[data-filter-group]');
      var filterGrid = $('[data-filter-grid]');

      filterGroup.find('[data-filter-category]').click(function(){
         var clickedFilter = $(this);
         var clickedFilterCategory = $(this).data('filter-category');
         if (clickedFilter.attr('data-filter-status') == 'active') {
         // If active > Do nothing
         }
         // All Filter
         else if (clickedFilterCategory == 'all') {
            $('[data-nav-filter-status]').attr('data-nav-filter-status', 'not-active');
            filterGrid.addClass('toggle-fade-out');
            filterGroup.find('[data-filter-category="' + clickedFilterCategory + '"]').attr('data-filter-status', 'active').siblings().attr('data-filter-status', 'not-active');
            setTimeout(function() {
               filterGrid.find('[data-filter-category]').attr('data-filter-status', 'active');
               filterGrid.removeClass('toggle-fade-out').addClass('toggle-fade-in');
               scroll.destroy();
               initLenis();
               initLenisCheckScrollUpDown();
            }, 200);
            setTimeout(function() {
               filterGrid.removeClass('toggle-fade-in');
               ScrollTrigger.refresh();
            }, 400);
         } 
         // Category Filters
         else {
            $('[data-nav-filter-status]').attr('data-nav-filter-status', 'not-active');
            filterGrid.addClass('toggle-fade-out');
            filterGroup.find('[data-filter-category="' + clickedFilterCategory + '"]').attr('data-filter-status', 'active').siblings().attr('data-filter-status', 'not-active');
            setTimeout(function() {
               filterGrid.find('[data-filter-category]').attr('data-filter-status', 'not-active');
               filterGrid.find('[data-filter-category="' + clickedFilterCategory + '"]').attr('data-filter-status', 'active');
               filterGrid.removeClass('toggle-fade-out').addClass('toggle-fade-in');
               scroll.destroy();
               initLenis();
               initLenisCheckScrollUpDown();
            }, 200);
            setTimeout(function() {
               filterGrid.removeClass('toggle-fade-in');
               ScrollTrigger.refresh();
            }, 400);
         }
      });
   });

   // Toggle Table
   $('[data-table-status]').each(function () {
      var singleTable = $(this);
      singleTable.find('[data-table-toggle="toggle"]').click(function(){
         if (singleTable.attr('data-table-status') == 'not-active') {
            singleTable.attr('data-table-status', 'active');
         } else {
            singleTable.attr('data-table-status', 'not-active');
         }
         setTimeout(function() {
            scroll.destroy();
            initLenis();
            initLenisCheckScrollUpDown();
            ScrollTrigger.refresh();
         }, 800);
      });
   });

}

/**
 * Lazy Load
 */
function initLazyLoad() {
   // https://github.com/verlok/vanilla-lazyload
   var lazyLoadInstance = new LazyLoad({ 
      container: document.querySelector('[data-scroll-container]'),
      elements_selector: ".lazy",
   });
}

/**
 * Play Video Inview
 */
function initScrollTriggerPlayVideoInview() {

   let allVideoDivs = gsap.utils.toArray('.playpauze');

   allVideoDivs.forEach((videoDiv, i) => {

      let videoElem = videoDiv.querySelector('video')

      ScrollTrigger.create({
         trigger: videoElem,
         start: '0% 120%',
         end: '100% -20%',
         onEnter: () => videoElem.play(),
         onEnterBack: () => videoElem.play(),
         onLeave: () => videoElem.pause(),
         onLeaveBack: () => videoElem.pause(),
      });
   });
}

/**
 * Lenis - Check Scroll up or Down
 */

function initLenisCheckScrollUpDown() {

   var lastScrollTop = 0
   var threshold = 50;
   var thresholdTop = 50;

   function startCheckScroll() {
      scroll.on('scroll', (e) => {
         var nowScrollTop = e.targetScroll;

         if (Math.abs(lastScrollTop - nowScrollTop) >= threshold) {
            
            // Check Scroll Direction
            if (nowScrollTop > lastScrollTop) {
               $("[data-scrolling-direction]").attr('data-scrolling-direction', 'down');
            } else {
               $("[data-scrolling-direction]").attr('data-scrolling-direction', 'up');
            }
            lastScrollTop = nowScrollTop;

            // Check if Scroll Started
            if (nowScrollTop > thresholdTop) {
               $("[data-scrolling-started]").attr('data-scrolling-started', 'true');
            } else {
               $("[data-scrolling-started]").attr('data-scrolling-started', 'false');
            }
         }
      });
   }
   startCheckScroll();

   // Reset instance
   barba.hooks.after(() => {
      startCheckScroll();
   });
}

/**
 * Lenis - ScrollTo Anchor Links
 */
function initScrollToAnchorLenis() {

   $("[data-anchor-target]").click(function() {
      let targetScrollToAnchorLenis = $(this).attr('data-anchor-target');
      scroll.scrollTo(targetScrollToAnchorLenis,{
         duration: 1,
         easing: (x) => (x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2),
      });
   });
}

/**
 * Scrolltrigger - Check Theme of Sections
 */
 function initScrollTriggerDataBackground() {

   // Calculate offset navigation
   let navHeight = $(".main-nav-bar .nav-bar-scrolled-height").innerHeight();

   // Check Theme (Dark/Light)
   $('[data-theme-section]').each(function(){

      var themeName = $(this).attr('data-theme-section');
      var singleSection = gsap.utils.toArray('[data-theme-section="' + themeName +  '"]');

      singleSection.forEach(singleSection => {
         ScrollTrigger.create({
            trigger: singleSection,
            start: () => "0% " + navHeight,
            end: "100% " + navHeight,
            onEnter: () => functionAddTheme(),
            onEnterBack: () => functionAddTheme(),
            markers: false,
         });
         function functionAddTheme() {
            if ($('[data-theme-nav]').attr('data-theme-nav') == themeName) {
            } else {
               $('[data-theme-nav]').attr('data-theme-nav', themeName);
            }
         };
      });
   });

   // Check Background Color
   $('[data-bg-section]').each(function(){

      var bgColorName = $(this).attr('data-bg-section');
      var singleBgColor = gsap.utils.toArray('[data-bg-section="' + bgColorName +  '"]');

      singleBgColor.forEach(singleBgColor => {
         ScrollTrigger.create({
            trigger: singleBgColor,
            start: () => "0% center",
            end: "100% center",
            onEnter: () => functionAddTheme(),
            onEnterBack: () => functionAddTheme(),
            markers: false,
         });
         function functionAddTheme() {
            if ($('[data-bg-nav]').attr('data-bg-nav') == bgColorName) {
            } else {
               $('[data-bg-nav]').attr('data-bg-nav', bgColorName);
            }
         };
      });
   });
}


/**
* GSAP Scrolltrigger Parallax Scroll
*/
function initScrollTriggerParallaxScroll() {

   ScrollTrigger.matchMedia({
      "(min-width: 1025px)": function() {

         if(document.querySelector('[data-parallax-strength]')) {
            $('[data-parallax-strength]').each(function () {
               
               let tl;
               let triggerElement = $(this);
               let targetElement = $(this).find('[data-parallax-target]');
               let triggerElementID = $(this).attr('data-parallax-trigger');
               let targetElementParallax = ($(this).attr('data-parallax-strength') * 20);
               let heightElementParallax = ($(this).attr('data-parallax-height') * 20);
               $(this).css("--parallax-strength", " " + targetElementParallax + "%");
               $(this).css("--parallax-height", " " + heightElementParallax + "%");

               
               // Check if [data-parallax-trigger="#header"] exists
               if ($(triggerElementID).length !== 0) {
                  triggerElement = $(document).find(triggerElementID);
               }
               
               tl = gsap.timeline({
                  scrollTrigger: {
                     trigger: triggerElement,
                     start: "0% 100%",
                     end: "100% 0%",
                     scrub: true,
                     markers: false
                  }
               });

               tl.set(targetElement, {
                  rotate: 0.001,
               });

               // if ($(this).attr('data-parallax-position') == 'top') {}

               tl.fromTo(targetElement, {
                  yPercent: (targetElementParallax * -0.5)
               }, {
                  yPercent: (targetElementParallax * 0.5),
                  ease: "none"
               });

            });
         }
      }
   });
}

/**
* Scrolltrigger Animations Desktop + Mobile
*/
function initScrolltriggerAnimations() {
    
   if(document.querySelector('footer')) {
      // Scrolltrigger Animation : Example
      $('footer').each(function (index) {
         let triggerElement = $(this).find('.row-book');
         let targetElement = $(this).find('.row-book .col');
         let targetElementButton = $(this).find('.row-book .col .btn');
      
         let tl = gsap.timeline({
            scrollTrigger: {
               trigger: triggerElement,
               start: "0% 100%",
               end: "100% 100%",
               scrub: 0,
            }
         });
         
         tl.from(targetElement, {
            yPercent: -50,
            ease: "none",
            duration: 2
         });
      });
   }
}

/**
* Scrolltrigger Animations Desktop + Mobile
*/
function initMews() {

   // Documentation: https://mews-systems.gitbook.io/booking-engine-guide/booking-engine-widget/advanced-guide

   // Always available api calls
   // distributor.open();
   // distributor.setLanguageCode(languageCode);
   // distributor.setCurrencyCode(currencyCode);
   // distributor.setStartDate(date);
   // distributor.setEndDate(date);
   // distributor.setVoucherCode(code);
   // distributor.showRooms();
   // distributor.showRates(roomId);
   
   Mews.Distributor({
      configurationIds: [
         '1802fb4c-34a2-455d-880f-ae4071d5b71a',
      ],
      openElements: '[data-mews-toggle="open"]',
   },
   function(distributor) {

      barba.hooks.afterEnter(() => {

         // $('[data-mews-toggle="open"]').click(function(){
         //    distributor.open();
         // });

         $('[data-mews-voucher]').click(function(){
            let voucherCode = $(this).attr('data-mews-voucher');
            distributor.setVoucherCode(voucherCode);
         });

         // $('[data-mews-room-id]').click(function(){
         //    let roomId = $(this).attr('data-mews-room-id');
         //    distributor.showRates(roomId);
         // });
      });
   });
}

/**
* Swiper Slider
*/
function initSwiperSlider() {

   $('[data-swiper-slider-type="stay"]').each(function (index) {
   
      var sliderIndexID = 'swiper-slider-type-stay-id-' + index;
      $(this).attr('id', sliderIndexID);
  
      var sliderThis = $(this);

      // Init Slider 1: Cards
      var swiperSliderMain = document.querySelector('#' + sliderIndexID + ' .swiper-carousel-main');
      var swiperMain = new Swiper(swiperSliderMain, {
         slidesPerView: 1,
         spaceBetween: 0,
         simulateTouch: false,
         loop: true,
         grabCursor: false,
         speed: 1200,
         navigation: {
            nextEl: document.querySelector('#' + sliderIndexID + ' [data-swiper-control="next"]'),
            prevEl: document.querySelector('#' + sliderIndexID + ' [data-swiper-control="prev"]'),
         },
         pagination: {
            el: document.querySelector('#' + sliderIndexID + ' .swiper-pagination'),
            clickable: true,
            renderBullet: function (index, className) {
               return '<span class="' + className + '"><div class="swiper-progress">' + '</div></span>';
            },
         },
         parallax: true,
         lazy: {
            loadPrevNext: true,
         },
         on: {
            slideChange: function () {
               sliderThis.find('.swiper-active-slide').text(this.realIndex + 1);
            },
         },
         allowTouchMove: false
      });

      // GSAP Animation Progress Bar (Will trigger slider to slide)
      var tl = gsap.timeline({paused: true});

      // Retrigger Animation on Slide Change
      function singleSwiperSliderEnd() {
         swiperMain.slideNext();
         swiperText.slideNext();
         tl.restart();
      }
      
      tl.to(sliderThis.find('.swiper-progress'), {
         duration: 5,
         scaleX: 1,
         ease: "Power1.easeInOut",
         onComplete: singleSwiperSliderEnd
      });

      // Reset Progress Bar On Slide Change
      swiperMain.on("slideChange", function () {
         tl.restart();
         addSwipeFadeClass();
      });

      // Play/Pause Slider in viewport
      sliderThis.each(function() {
         let triggerElement = $(this);
         ScrollTrigger.create({
            trigger: triggerElement,
            start: '0% 100%',
            end: '100% 0%',
            onEnter: () => tl.play(),
            onEnterBack: () => tl.play(),
            onLeave: () => tl.pause(),
            onLeaveBack: () => tl.pause(),
         });
      });

      // Init Slider 2: Fade
      var swiperSliderFade = document.querySelector('#' + sliderIndexID + ' .swiper-carousel-fade');
      var swiperFade = new Swiper(swiperSliderFade, {
         slidesPerView: 1,
         simulateTouch: false,
         loop: true,
         grabCursor: false,
         parallax: true,
         effect: "fade",
         allowTouchMove: false
      });

      // Init Slider 3: Text
      var swiperSliderText = document.querySelector('#' + sliderIndexID + ' .swiper-carousel-text');
      var swiperText = new Swiper(swiperSliderText, {
         slidesPerView: "auto",
         spaceBetween: 0,
         simulateTouch: false,
         loop: true,
         grabCursor: false,
         centeredSlides: true,
         speed: 1200,
         navigation: {
            nextEl: document.querySelector('#' + sliderIndexID + ' [data-swiper-control="next"]'),
            prevEl: document.querySelector('#' + sliderIndexID + ' [data-swiper-control="prev"]'),
         },
         parallax: true,
         lazy: {
            loadPrevNext: true,
         },
         allowTouchMove: false
      });

      function addSwipeFadeClass() {
         sliderThis.find('.swiper-slide').addClass('slide-is-transitioning');
         sliderThis.find('.swiper-slide-visible').removeClass('slide-is-transitioning');
         setTimeout(function() {
           sliderThis.find('.swiper-slide').removeClass('slide-is-transitioning');
         }, 1200);
       }
      
      // Connect Swiper Sliders
      swiperMain.controller.control = [swiperFade];
      
   });


   $('[data-swiper-slider-type="double"]').each(function (index) {
   
      var sliderIndexID = 'swiper-slider-type-double-id-' + index;
      $(this).attr('id', sliderIndexID);
  
      var sliderThis = $(this);

      // Init Slider 1: Cards
      var swiperSliderMain = document.querySelector('#' + sliderIndexID + ' .swiper-carousel-main');
      var swiperMain = new Swiper(swiperSliderMain, {
         slidesPerView: 1,
         simulateTouch: false,
         loop: true,
         grabCursor: false,
         speed: 1200,
         navigation: {
            nextEl: document.querySelector('#' + sliderIndexID + ' [data-swiper-control="next"]'),
            prevEl: document.querySelector('#' + sliderIndexID + ' [data-swiper-control="prev"]'),
         },
         pagination: {
            el: document.querySelector('#' + sliderIndexID + ' .swiper-pagination'),
            clickable: true,
            renderBullet: function (index, className) {
               return '<span class="' + className + '"><div class="swiper-progress">' + '</div></span>';
            },
         },
         parallax: true,
         lazy: {
            loadPrevNext: true,
         },
         on: {
            slideChange: function () {
               sliderThis.find('.swiper-active-slide').text(this.realIndex + 1);
            },
         }
      });

      // GSAP Animation Progress Bar (Will trigger slider to slide)
      var tl = gsap.timeline({paused: true});

      // Retrigger Animation on Slide Change
      function singleSwiperSliderEnd() {
         swiperMain.slideNext();
         tl.restart();
      }
      
      tl.to(sliderThis.find('.swiper-progress'), {
         duration: 5,
         scaleX: 1,
         ease: "Power1.easeInOut",
         onComplete: singleSwiperSliderEnd
      });

      // Reset Progress Bar On Slide Change
      swiperMain.on("slideChange", function () {
         tl.restart();
      });

      // Pause Carousel/Progress Bar On Hover
      sliderThis.find('.swiper-controls').on('mouseenter', function() {
         tl.pause();
      });

      sliderThis.find('.swiper-controls').on('mouseleave', function() {
         tl.resume();
      });

      // Play/Pause Slider in viewport
      sliderThis.each(function() {
         let triggerElement = $(this);
      
         ScrollTrigger.create({
         trigger: triggerElement,
         start: '0% 120%',
         end: '100% -20%',
         onEnter: () => tl.play(),
         onEnterBack: () => tl.play(),
         onLeave: () => tl.pause(),
         onLeaveBack: () => tl.pause(),
         });

      });

      // Init Slider 2: Secondary
      var swiperSliderSecondary = document.querySelector('#' + sliderIndexID + ' .swiper-carousel-secondary');
      var swiperSecondary = new Swiper(swiperSliderSecondary, {
         slidesPerView: 1,
         simulateTouch: false,
         loop: true,
         grabCursor: false,
         speed: 1200,
         parallax: true,
         lazy: {
            loadPrevNext: true,
         }
      });
      
      // Connect Swiper Sliders
      swiperMain.controller.control = [swiperSecondary];
      swiperSecondary.controller.control = [swiperMain];
      
   });

}

/**
* Custom Cursor
*/
function initCustomCursor() {
    
   // Sticky Cursor with delay
   // https://greensock.com/forums/topic/21161-animated-mouse-cursor/
 
   var posXBtn = 0
   var posYBtn = 0
   var mouseX = 0
   var mouseY = 0
 
   if(document.querySelector(".custom-cursor")) {
      gsap.to({}, 0.0083333333, {
         repeat: -1,
         onRepeat: function() {
      
            if(document.querySelector(".custom-cursor")) {
               posXBtn += (mouseX - posXBtn) / 5;
               posYBtn += (mouseY - posYBtn) / 5;
               gsap.set($(".custom-cursor"), {
                  css: {
                     left: posXBtn,
                     top: posYBtn
                  }
               });
            }
         }
      });
   }
 
   $(document).on("mousemove", function(e) {
      mouseX = e.clientX;
      mouseY = e.clientY;
   });
 
   // Mouse Init
   $('body').on('mousemove', function() {
      if ($('[data-cursor-init]').attr('data-cursor-init') == 'false') {
         $('[data-cursor-init]').attr('data-cursor-init', 'true');
      }
   });
 
   // Normal Hover
   $('[data-cursor-bubble-text]').on('mouseenter', function() {
      let dataCursorText = $(this).data('cursor-bubble-text');
      $('[data-cursor-bubble]').attr('data-cursor-bubble', 'active');
      $('.custom-cursor').find('.cursor-bubble .cursor-text').text(dataCursorText);
   });
   $('[data-cursor-bubble-text]').on('mouseleave', function() {
      $('[data-cursor-bubble]').attr('data-cursor-bubble', 'not-active');
   });   
}