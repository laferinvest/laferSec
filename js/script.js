var vhash = "";

$(function () {
    vhash = window.location.hash;
});

$(window).bind('hashchange', function () {
    vhash = window.location.hash;
    if (vhash != "undefined") {
        var top = $(vhash).offset().top;
        $('html,body').animate({ scrollTop: top - 100 }, 'slow');
    }
});

$(document).ready(function () {
    if (vhash != "undefined" && vhash != "") {
        var top = $(vhash).offset().top;
        $('html,body').animate({ scrollTop: top - 100 }, 'slow');
    }

    // Initialize other plugins that don't depend on full window load
    $('.empresas').slick({
        dots: false,
        infinite: true,
        speed: 400,
        slidesToShow: 4,
        adaptiveHeight: true
    });

    $('.produtos-slider').slick({
        dots: true,
        infinite: true,
        speed: 300,
        slidesToShow: 1,
        adaptiveHeight: true
    });
});

// Move slider initialization to the window load handler
$(window).on('load', function() {
    $('#slider').nivoSlider({
        effect: 'fade',           // Specify sets like: 'fold,fade,sliceDown'
        animSpeed: 1000,          // Slide transition speed
        pauseTime: 6000,          // How long each slide will show
        startSlide: 0,            // Set starting Slide (0 index)
        directionNav: true,       // Next & Prev navigation
        directionNavHide: true,   // Only show on hover
        controlNav: false,        // 1,2,3... navigation
        controlNavThumbs: false,  // Use thumbnails for Control Nav
        controlNavThumbsFromRel: false,
        controlNavThumbsSearch: '.jpg',
        controlNavThumbsReplace: '_thumb.jpg',
        keyboardNav: true,
        pauseOnHover: false,
        manualAdvance: false,
        captionOpacity: 0.8,
        prevText: 'Prev',
        nextText: 'Next'
    });
});
