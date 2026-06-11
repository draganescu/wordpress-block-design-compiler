gsap.registerPlugin(ScrollTrigger, SplitText);

let scroll;

const body = document.body;
const select = (e) => document.querySelector(e);
const selectAll = (e) => document.querySelectorAll(e);
//const container = select('.site-main');

initPageTransitions();

const btnWidth = $("header .btn").width() + 1;
const btnHeight = $("header .btn").height();

// Animation - First Page Load
function initLoader() {

   var tl = gsap.timeline();

   tl.call(function() {
      scroll.start();
   });

   tl.set(".loading-fade", {
      autoAlpha: 0,
   });

   tl.set("header .single-word-inner", {
      yPercent: 125,
      rotate: 0.001,
      opacity: 0
   });

   tl.set(".fade-in, .fade-in-first", {
      y: "2em",
      opacity: 0
   });

   if (document.querySelector(".fade-in-cookie")) {
   tl.set(".fade-in-cookie", {
      yPercent: 115
   });
   }

   if (document.querySelector("header .btn-animate")) {
   tl.set("header .btn-animate", {
      maxWidth: btnHeight + "px",
      overflow: "hidden",
      rotate: 0.001
   });
   }

   tl.to(".loading-screen .overlay-swipe", {
      duration: 1.5,
      scaleX: 0,
      ease: "Expo.easeInOut"
   });

   tl.to(".loading-screen .count-up", {
      duration: 1.5,
      innerText: 100,
      snap: {
         innerText: 1
      },
      ease: "Expo.easeInOut"
   }, "<");

   tl.to(".loading-screen", {
      duration: .55,
      autoAlpha: 0,
      ease: "Power3.easeIn",
      delay: 0.5
   });

   tl.to(".loading-screen .logo, .loading-screen .counter h3", {
      yPercent: -100,
      ease: "Power3.easeIn"
   }, "<");

   tl.to(".fade-in-first", {
      duration: 1.5,
      y: "0em",
      opacity: 1,
      ease: "Expo.easeOut",
      delay: 0,
      rotate: 0.001,
      clearProps: "all",
      delay: 0.5
   }, "<");

   tl.to("header .single-word-inner", {
      duration: 1,
      yPercent: 0,
      opacity: 1,
      ease: "Expo.easeOut",
      stagger: .025,
      rotate: 0.001,
   }, "<");

   tl.to(".fade-in", {
      duration: 1.5,
      y: "0em",
      opacity: 1,
      ease: "Expo.easeOut",
      stagger: .05,
      rotate: 0.001,
      clearProps: "all"
   }, "<");

   if (document.querySelector("header .btn-animate")) {
   tl.to("header .btn-animate", {
      duration: 1.25,
      maxWidth: btnWidth + "px",
      clearProps: "all",
      ease: "Expo.easeOut",
      rotate: 0.001
   }, "<");
   }

   if (document.querySelector(".fade-in-cookie")) {
   tl.to(".fade-in-cookie", {
      duration: 1.25,
      yPercent: 0,
      opacity: 1,
      ease: "Expo.easeOut",
      stagger: .05,
      delay: 0,
      rotate: 0.001,
      clearProps: "all"
   }, "<");
   }

}

// Animation - Page transition In
function pageTransitionIn() {
   var tl = gsap.timeline();

   tl.call(function() {
      scroll.stop();
   });

   tl.to(".loading-fade", {
      duration: .45,
      autoAlpha: 1,
      ease: "Power3.easeOut"
   });

   tl.to(".loading-fade", {
      duration: .45,
      autoAlpha: 0,
      ease: "Linear.easeIn",
      delay: .2
   });

}


// Animation - Page transition Out
function pageTransitionOut() {
   var tl = gsap.timeline();

   tl.call(function () {
      scroll.start();
   });

   tl.set(".loading-screen", {
      autoAlpha: 0,
   });
   
   tl.set("header .single-word-inner", {
      yPercent: 125,
      rotate: 0.001,
      opacity: 0
   });

   tl.set(".fade-in, .fade-in-first", {
      y: "2em",
      opacity: 0
   });

   tl.to(".fade-in-first", {
      duration: 1.5,
      y: "0em",
      opacity: 1,
      ease: "Expo.easeOut",
      delay: 0,
      rotate: 0.001,
      clearProps: "all",
      delay: 0.25
   });

   tl.to("header .single-word-inner", {
      duration: 1,
      yPercent: 0,
      opacity: 1,
      ease: "Expo.easeOut",
      stagger: .025,
      delay: 0,
      rotate: 0.001,
   }, "<");

   tl.to(".fade-in", {
      duration: 1.5,
      y: "0em",
      opacity: 1,
      ease: "Expo.easeOut",
      stagger: .05,
      delay: 0,
      rotate: 0.001,
      clearProps: "all"
   }, "< 0.2");

}

function initPageTransitions() {

   //let scroll;

   // do something before the transition starts
   barba.hooks.before(() => {
      select('html').classList.add('is-transitioning');
   });

   // do something after the transition finishes
   barba.hooks.after(() => {
      select('html').classList.remove('is-transitioning');
      // reinit locomotive scroll
      scroll.init();
      scroll.stop();
   });

   // scroll to the top of the page
   barba.hooks.enter(() => {
      scroll.destroy();
   });

   // scroll to the top of the page
   barba.hooks.afterEnter(() => {
      window.scrollTo(0, 0);
   });

   barba.init({
      sync: true,
      debug: false,
      timeout: 7000,
      transitions: [{
         name: 'default',
         once(data) {
            // do something once on the initial page load
            initSmoothScroll(data.next.container);
            initScript();
            initLoader();
         },
         async leave(data) {
            // animate loading screen in
            pageTransitionIn(data.current);
            await delay(500);
            data.current.container.remove();
         },
         async enter(data) {
            // animate loading screen away
            pageTransitionOut(data.next);

         },
         async beforeEnter(data) {
            ScrollTrigger.getAll().forEach(t => t.kill());
            scroll.destroy();
            initSmoothScroll(data.next.container);
            initScript();
         },
      },
      {
         name: 'self',
         once(data) {
            // do something once on the initial page load
            initSmoothScroll(data.next.container);
            initScript();
            initLoader();
         },
         async leave(data) {
            // animate loading screen in
            pageTransitionIn(data.current);
            await delay(500);
            data.current.container.remove();
         },
         async enter(data) {
            // animate loading screen away
            pageTransitionOut(data.next);

         },
         async beforeEnter(data) {
            ScrollTrigger.getAll().forEach(t => t.kill());
            scroll.destroy();
            initSmoothScroll(data.next.container);
            initScript();
         },
      }]
   });

   function initSmoothScroll(container) {

      scroll = new LocomotiveScroll({
         el: container.querySelector('[data-scroll-container]'),
         smooth: true,
         lerp: 0.15
      });

      window.onresize = scroll.update();

      scroll.on("scroll", () => ScrollTrigger.update());

      ScrollTrigger.scrollerProxy('[data-scroll-container]', {
         scrollTop(value) {
            return arguments.length ? scroll.scrollTo(value, 0, 0) : scroll.scroll.instance.scroll.y;
         }, // we don't have to define a scrollLeft because we're only scrolling vertically.
         getBoundingClientRect() {
            return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
         },
         // LocomotiveScroll handles things completely differently on mobile devices - it doesn't even transform the container at all! So to get the correct behavior and avoid jitters, we should pin things with position: fixed on mobile. We sense it by checking to see if there's a transform applied to the container (the LocomotiveScroll-controlled element).
         pinType: container.querySelector('[data-scroll-container]').style.transform ? "transform" : "fixed"
      });

      ScrollTrigger.defaults({
         scroller: document.querySelector('[data-scroll-container]'),
      });

      /**
       * Remove Old Locomotive Scrollbar
       */

      const scrollbar = selectAll('.c-scrollbar');

      if (scrollbar.length > 1) {
         scrollbar[0].remove();
      }

      // each time the window updates, we should refresh ScrollTrigger and then update LocomotiveScroll. 
      ScrollTrigger.addEventListener('refresh', () => scroll.update());

      // after everything is set up, refresh() ScrollTrigger and update LocomotiveScroll because padding may have been added for pinning, etc.
      ScrollTrigger.refresh();
   }
}

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
   select('body').classList.remove('is-loading');
   initFlickitySlider();
   initWindowInnerheight();
   initCheckScrollUpDown();
   initCheckTouchDevice();
   initBasicFunctions();
   initLazyLoad();
   initPlayVideoInview();
   initSplitText();
   initScrollToLoco();
   initDataBackground();
   initSwiperSlider();
   initSocialShare();
   initCustomFormUpload();
   initScrolltriggerAnimations();
}

/**
* Window Inner Height Check
*/
function initWindowInnerheight() {

   // https://css-tricks.com/the-trick-to-viewport-units-on-mobile/
   $(document).ready(function () {
      let vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
   });

}

/**
* Check Scroll up or Down
*/
function initCheckScrollUpDown() {

   var lastScrollTop = 0
   var threshold = 50;

   function startCheckScroll() {
      scroll.on('scroll', (instance) => {
         var nowScrollTop = instance.scroll.y;
         if (Math.abs(lastScrollTop - nowScrollTop) >= threshold) {
            if (nowScrollTop > lastScrollTop) {
               $("main, .nav-bar").addClass('scroll-direction-down');
            } else {
               $("main, .nav-bar").removeClass('scroll-direction-down');
            }
            lastScrollTop = nowScrollTop;

            if (nowScrollTop > threshold) {
               $("main, .nav-bar").addClass('scroll-scrolled');
               $(".nav-bar").removeClass('nav-see-through');
            } else {
               $("main, .nav-bar").removeClass('scroll-scrolled');
               $(".nav-bar").addClass('nav-see-through');
            }
         }
      });
   }
   startCheckScroll();

   barba.hooks.after(() => {
      startCheckScroll();
   });
}

/**
* Check touch device
*/
function initCheckTouchDevice() {

   function isTouchScreendevice() {
      return 'ontouchstart' in window || navigator.maxTouchPoints;
   };

   if (isTouchScreendevice()) {
      $('main').addClass('touch');
      $('main').removeClass('no-touch');
   } else {
      $('main').removeClass('touch');
      $('main').addClass('no-touch');
   }
   $(window).resize(function () {
      if (isTouchScreendevice()) {
         $('main').addClass('touch');
         $('main').removeClass('no-touch');
      } else {
         $('main').removeClass('touch');
         $('main').addClass('no-touch');
      }
   });

}

/**
* Basic Functions
*/
function initBasicFunctions() {


   $(document).ready(function () {
      $(".nav-bar [data-toggle='modal-language']").click(function () {
         if ($(".modal-language").hasClass('active')) {
            $(".modal-language, .modal-background").removeClass('active');
            scroll.start();
         } else {
            $(".modal").removeClass('modal-language-bottom');
            $(".modal-language, .modal-background").addClass('active');
            scroll.stop();
         }
      });
      $(".footer [data-toggle='modal-language']").click(function () {
         if ($(".modal-language").hasClass('active')) {
            $(".modal-language, .modal-background").removeClass('active');
            scroll.start();
         } else {
            $(".modal-language, .modal-background").addClass('active');
            $(".modal-language").addClass('modal-language-bottom ');
            scroll.stop();
         }
      });
      $("[data-toggle='modal-search']").click(function () {
         if ($(".modal-search").hasClass('active')) {
            $(".modal-search, .modal-background").removeClass('active');
            scroll.start();
         } else {
            $(".modal-search, .modal-background").addClass('active');
            scroll.stop();
            setTimeout(function () {
               $(":input[name=q]").focus();
            }, 100);
         }
      });
      $("[data-empty='type-bar']").click(function () {
         $('').val('');
      });
      $("[data-toggle='modal-filter']").click(function () {
         if ($(".modal-filter").hasClass('active')) {
            $(".modal-filter, .modal-background").removeClass('active');
            scroll.start();
         } else {
            $(".modal-filter, .modal-background").addClass('active');
            scroll.stop();
         }
      });
      $("[data-toggle='modal-mobile-nav']").click(function () {
         if ($(".modal-mobile-nav").hasClass('active')) {
            $(".modal-mobile-nav, .modal-background").removeClass('active');
            scroll.start();
         } else {
            $(".modal-mobile-nav, .modal-background").addClass('active');
            scroll.stop();
         }
      });
      $("[data-close='modal']").click(function () {
         $(".modal, .modal-background").removeClass('active');
         $(".type-bar").val('');
         scroll.start();
      });
   });
   $(document).keydown(function (e) {
      if (e.keyCode == 27) {
         if ($(".modal").hasClass('active')) {
            $(".modal, .modal-background").removeClass('active');
            scroll.start();
         }
      }
   });

   $(".single-actueel-item").each(function () {
      var item = $(this);
      item.find("[data-link='item']").on("mouseenter mouseleave", function () {
         if ($(item).hasClass('hover')) {
            item.removeClass('hover');
         } else {
            item.addClass('hover');
         }
      });
   });

   $(".section-map").click(function () {
      $(".section-map iframe").css("pointer-events", "auto");
   });

   $(".section-map").mouseleave(function() {
      $(".section-map iframe").css("pointer-events", "none"); 
   });

}

/**
* Lazy Load
*/
function initLazyLoad() {
   // https://github.com/locomotivemtl/locomotive-scroll/issues/225
   // https://github.com/verlok/vanilla-lazyload
   var lazyLoadInstance = new LazyLoad({
      elements_selector: ".lazy",
   });

}

/**
* Play Video Inview
*/
function initPlayVideoInview() {

   let allVideoDivs = gsap.utils.toArray('.playpauze');

   allVideoDivs.forEach((videoDiv, i) => {

      let videoElem = videoDiv.querySelector('video')

      ScrollTrigger.create({
         scroller: document.querySelector('[data-scroll-container]'),
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
* GSAP Split Text
*/
function initSplitText() {

   var splitTextWords = new SplitText(".split-words", {type: "words", wordsClass: "single-word"});
   $('.split-words .single-word').wrapInner('<div class="single-word-inner">');
 
}

/**
 * ScrollTo Anchor Links
 */
 function initScrollToLoco() {

   var navHeight = $(".nav-height").height();
	$("[data-target]").click(function() {
      navHeight = $(".nav-height").height();
		let target = $(this).data('target');
		scroll.scrollTo(target,{
			'duration': 1200,
			'easing':[0.7, 0, 0.1, 1],
			'disableLerp': false,
         'offset': -navHeight,
		});
	});

   var sendTarget = document.querySelector('#target-send');
    if (window.location.href.indexOf("?target=send") > -1) {
      setTimeout(function() {
        scroll.scrollTo(sendTarget ,{
          'duration': 100,
          'easing':[1, 0, 0, 1],
          'disableLerp': false,
          'offset': -navHeight
        });
      }, 50);
    }
}

function initDataBackground() {

   const navHeight = $(".nav-main").height() * 0.8;

   const sectionsDark = gsap.utils.toArray('.theme-dark');
   sectionsDark.forEach(sectionDark => {

      ScrollTrigger.create({
         trigger: sectionDark,
         start: () => "0% " + navHeight,
         end: "100% " + navHeight,
         onEnter: () => functionAddDark(),
         onEnterBack: () => functionAddDark(),
         markers: false,
      });
      function functionAddDark() {
         if ($("main, .nav-bar").hasClass('theme-nav-dark')) {
         } else {
            $("main, .nav-bar").removeClass('theme-nav-light-medium');
            $("main, .nav-bar").removeClass('theme-nav-light');
            $("main, .nav-bar").addClass('theme-nav-dark');
         }
      };
   });

   const sectionsLight = gsap.utils.toArray('.theme-light');
   sectionsLight.forEach(sectionLight => {

      ScrollTrigger.create({
         trigger: sectionLight,
         start: () => "0% " + navHeight,
         end: "100% " + navHeight,
         onEnter: () => functionAddLight(),
         onEnterBack: () => functionAddLight(),
         markers: false,
      });
      function functionAddLight() {
         if ($("main, .nav-bar").hasClass('theme-nav-light')) {
         } else {
            $("main, .nav-bar").removeClass('theme-nav-light-medium');
            $("main, .nav-bar").removeClass('theme-nav-dark');
            $("main, .nav-bar").addClass('theme-nav-light');
         }
      };
   });

   const sectionsLightMedium = gsap.utils.toArray('.theme-light-medium');
   sectionsLightMedium.forEach(sectionsLightMedium => {

      ScrollTrigger.create({
         trigger: sectionsLightMedium,
         start: () => "0% " + navHeight,
         end: "100% " + navHeight,
         onEnter: () => functionAddLightMedium(),
         onEnterBack: () => functionAddLightMedium(),
         markers: false,
      });
      function functionAddLightMedium() {
         if ($("main, .nav-bar").hasClass('theme-nav-light-medium')) {
         } else {
            $("main, .nav-bar").removeClass('theme-nav-dark');
            $("main, .nav-bar").removeClass('theme-nav-light');
            $("main, .nav-bar").addClass('theme-nav-light-medium');
         }
      };
   });

}

/**
* Flickity Slider
*/
function initFlickitySlider() {

   // Source
   // https://flickity.metafizzy.co/

   // Slider Row

   $('.flickity-slider-row').each(function (index) {

      var sliderIndexID = 'slider-row-id-' + index;
      $(this).attr('id', sliderIndexID);

      var sliderThis = $(this);

      var flickitySliderMain = document.querySelector('#' + sliderIndexID + ' .flickity-carousel');
      var flickityMain = sliderThis.find('.flickity-carousel').flickity({
         // options
         watchCSS: true,
         contain: true,
         wrapAround: false,
         dragThreshold: 10,
         prevNextButtons: false,
         pageDots: false,
         cellAlign: 'left',
         selectedAttraction: 0.015,
         friction: 0.25,
         percentPosition: true,
         on: {
            'dragStart': () => {
               flickityMain.css("pointer-events", "none");
            },
            'dragEnd': () => {
               flickityMain.css("pointer-events", "auto");
            }
            ,
            change: function () {
               updatePagination();
            }
         }
      });

      // Flickity instance
      var flkty = flickityMain.data('flickity');

      // previous
      var prevButton = sliderThis.find('.flickity-btn-prev').on('click', function () {
         flickityMain.flickity('previous');;
      });
      // next
      var nextButton = sliderThis.find('.flickity-btn-next').on('click', function () {
         flickityMain.flickity('next');
      });

      // Get the amount of columns variable and use to calc last slide
      var inviewColumns = window.getComputedStyle(flickitySliderMain).getPropertyValue('--columns');
      function updatePagination() {

         // enable/disable previous/next buttons
         if (!flkty.cells[flkty.selectedIndex - 1]) {
            prevButton.attr('disabled', 'disabled');
            nextButton.removeAttr('disabled'); // <-- remove disabled from the next
         } else if (!flkty.cells[flkty.selectedIndex + parseInt(inviewColumns)]) {
            nextButton.attr('disabled', 'disabled');
            prevButton.removeAttr('disabled'); //<-- remove disabled from the prev
         } else {
            prevButton.removeAttr('disabled');
            nextButton.removeAttr('disabled');
         }

      }


   });

}

/**
* Swiper Slider
*/
function initSwiperSlider() {

   // Custom slider tutorial
   // Tutorial: https://arnost.medium.com/creating-custom-slide-transitions-in-swiper-js-also-with-gsap-ac71f9badf53
   // Result: https://codepen.io/paralleluniv3rse/pen/yGQjMv

   $('.actueel-swiper-slider').each(function(index){

      var sliderIndexID = 'slider-single-id-' + index;
      $(this).attr('id', sliderIndexID);
  
      var sliderThis = $(this);
  
      // Init Slider 1: Primary
      var swiperSliderMain = document.querySelector('#' + sliderIndexID + ' .swiper-container-main');
      var swiperMain = new Swiper(swiperSliderMain, {
        simulateTouch: false,
        loop: true,
        grabCursor: false,
        speed: 1200,
        pagination: {
          el: ".swiper-pagination",
          clickable: true,
          renderBullet: function (index, className) {
              return '<span class="' + className + '"><div class="progress">' + '</div></span>';
          },
        },
        lazy: {
          loadPrevNext: true,
        },
        simulateTouch: false,
        effect: "fade"
      });
  
  
      // GSAP Animation Progress Bar (Will trigger slider to slide)
      var tl = gsap.timeline({paused: true});
  
      // Retrigger Animation on Slide Change
      function singleSwiperSliderEnd() {
        swiperMain.slideNext();
        tl.restart();
      }
      
      tl.to(sliderThis.find('.progress'), {
        duration: 5,
        scaleX: 1,
        ease: "Power1.easeInOut",
        onComplete: singleSwiperSliderEnd
      });
  
      // Reset Progress Bar On Slide Change
      swiperMain.on("slideChange", function () {
        startMainSliderBoth();
        addSwiperActiveContent();
      });

      startMainSliderBoth();

      function startMainSliderBoth() {
         tl.restart();
         addSwiperActiveZoom();
      }
  
      // Pause Carousel/Progress Bar On Hover
      sliderThis.find('.swiper-pagination').on('mouseenter', function() {
        tl.pause();
      });
  
      sliderThis.find('.swiper-pagination').on('mouseleave', function() {
        tl.resume();
      });

      function addSwiperActiveZoom() {
         gsap.fromTo(".swiper-slide-visible .overlay-zoom", {
            scale: 1
         }, {
            scale: 1.05, 
            ease: "Power1.easeInOut",
            duration: 6.2
         });
      }
      function addSwiperActiveContent() {
         gsap.fromTo(".swiper-slide-visible .flex-col:nth-child(1)", {
            yPercent: 10,
            opacity: 0
         }, {
            yPercent: 0, 
            ease: "Expo.easeOut",
            duration: 1.5,
            opacity: 1,
            delay: 0.9
         });
      }

   });

   $('.card-swiper-slider').each(function(index){

      var sliderIndexID = 'slider-single-id-' + index;
      $(this).attr('id', sliderIndexID);
  
      var sliderThis = $(this);
  
      // Init Slider 1: Primary
      var swiperSliderMain = document.querySelector('#' + sliderIndexID + ' .swiper-container-card');
      var swiperMain = new Swiper(swiperSliderMain, {
        simulateTouch: false,
        loop: true,
        grabCursor: false,
        speed: 1200,
        pagination: {
          el: ".swiper-pagination",
          clickable: true,
          renderBullet: function (index, className) {
              return '<span class="' + className + '"><div class="progress">' + '</div></span>';
          },
        },
        lazy: {
          loadPrevNext: true,
        },
        simulateTouch: false
      });
  
  
      // GSAP Animation Progress Bar (Will trigger slider to slide)
      var tl = gsap.timeline({paused: true});
  
      // Retrigger Animation on Slide Change
      function singleSwiperSliderEnd() {
        swiperMain.slideNext();
        tl.restart();
      }
      
      tl.to(sliderThis.find('.progress'), {
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
      sliderThis.find('.swiper-pagination').on('mouseenter', function() {
        tl.pause();
      });
  
      sliderThis.find('.swiper-pagination').on('mouseleave', function() {
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


   });

   $('.quote-swiper-slider').each(function(index){

      var sliderIndexID = 'slider-single-id-' + index;
      $(this).attr('id', sliderIndexID);
  
      var sliderThis = $(this);
  
      // Init Slider 1: Primary
      var swiperSliderMain = document.querySelector('#' + sliderIndexID + ' .swiper-container-quote');
      var swiperMain = new Swiper(swiperSliderMain, {
         simulateTouch: false,
         grabCursor: false,
         speed: 700,
         lazy: {
            loadPrevNext: true,
         },
         simulateTouch: false,
         effect: "fade",
         navigation: {
            nextEl: ".swiper-btn-next",
            prevEl: ".swiper-btn-prev"
          },
      });

   });
}

/**
 *  Social sharing popup window
 */

function initSocialShare() {

   ;(function($){
      /**
       * jQuery function to prevent default anchor event and take the href * and the title to make a share popup
       *
       * @param  {[object]} e           [Mouse event]
       * @param  {[integer]} intWidth   [Popup width defalut 500]
       * @param  {[integer]} intHeight  [Popup height defalut 400]
       * @param  {[boolean]} blnResize  [Is popup resizeabel default true]
       */
      $.fn.customerPopup = function (e, intWidth, intHeight, blnResize) {
        
        // Prevent default anchor event
        e.preventDefault();
        
        // Set values for window
        intWidth = intWidth || '500';
        intHeight = intHeight || '400';
        strResize = (blnResize ? 'yes' : 'no');
    
        // Set title and open popup with focus on it
        var strTitle = ((typeof this.attr('title') !== 'undefined') ? this.attr('title') : 'Social Share'),
            strParam = 'width=' + intWidth + ',height=' + intHeight + ',resizable=' + strResize,            
            objWindow = window.open(this.attr('href'), strTitle, strParam).focus();
      }
      
      /* ================================================== */
      
      $(document).ready(function ($) {
        $('.single-social-share.pop-up').on("click", function(e) {
          $(this).customerPopup(e);
        });
      });
        
    }(jQuery));
}

/**
* Form Upload
*/
function initCustomFormUpload() {

   if (document.querySelector("#upload-btn")) {
      const uploadBtn = document.getElementById('upload-btn');

      const fileChosen = document.getElementById('file-chosen');

      uploadBtn.addEventListener('change', function(){
         fileChosen.textContent = this.files[0].name
      });
   }

}

/**
* Scrolltrigger Animations Desktop + Mobile
*/
function initScrolltriggerAnimations() {

   if (document.querySelector(".example")) {
      // Scrolltrigger Animation : Example
      $(".example").each(function (index) {
         let triggerElement = $(this);
         let targetElement = $(this);

         let tl = gsap.timeline({
            scrollTrigger: {
               trigger: triggerElement,
               start: "0% 100%",
               end: "100% 0%",
               scrub: 0
            }
         });
         tl.to(targetElement, {
            rotate: 90,
            ease: "none"
         });
      });
   }

   // Disable GSAP on Mobile
   // Source: https://greensock.com/forums/topic/26325-disabling-scrolltrigger-on-mobile-with-mediamatch/
   ScrollTrigger.matchMedia({

      // Desktop Only Scrolltrigger 
      "(min-width: 721px)": function () {

         if (document.querySelector(".example")) {
            // Scrolltrigger Animation : Example
            $(".example").each(function (index) {
               let triggerElement = $(this);
               let targetElement = $(this);

               let tl = gsap.timeline({
                  scrollTrigger: {
                     trigger: triggerElement,
                     start: "0% 100%",
                     end: "100% 0%",
                     scrub: 0
                  }
               });
               tl.to(targetElement, {
                  rotate: 90,
                  ease: "none"
               });
            });
         }


      }, // End Desktop Only Scrolltrigger

      // Mobile Only Scrolltrigger
      "(max-width: 720px)": function () {

         if (document.querySelector(".example")) {
            // Scrolltrigger Animation : Example
            $(".example").each(function (index) {
               let triggerElement = $(this);
               let targetElement = $(".example");

               let tl = gsap.timeline({
                  scrollTrigger: {
                     trigger: triggerElement,
                     start: "0% 100%",
                     end: "100% 0%",
                     scrub: 0
                  }
               });
               tl.to(targetElement, {
                  rotate: 90,
                  ease: "none"
               });
            });
         }
      } // End Mobile Only Scrolltrigger

   }); // End GSAP Matchmedia

}
