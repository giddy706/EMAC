/*global $, jQuery, alert*/
/*---------------------------------------

Project: Beginn SaaS & Software Landing Page
Template Version: 1.0
Author: YasirKareem

01. All Script
    02.1 Navbar Fixed Top
    02.2 Navbar Toggle
    02.3 Navbar Collapse Hide
    02.4 Scrollspy
    02.5 Scroll Top
    02.6 Toggle Password
    02.7 Testimonials  
02. Faq Accordion

---------------------------------------*/
/* ========================
        All Script
    ======================== */
$(function () {
    'use strict';
    /* ========================
        Navbar Fixed Top
    ======================== */
    $(window).scroll(function () {
        if ($('.navbar').offset().top > 50) {
            $('.fixed-top').addClass('top-nav');
        } else {
            $('.fixed-top').removeClass('top-nav');
        }
    });
    /* ========================
        Navbar Toggle
    ======================== */
    $('.collapsed').on('click', function () {
        $('.navbar-toggler').toggleClass('change');
    });
/* ========================
        Navbar Collapse Hide
    ======================== */
    $('a.click-close').on('click', function () {
        $('.navbar-collapse').collapse('hide');
    });

    /* ========================
        Scrollspy 
    ======================== */
       
    $('body').scrollspy({target: ".navbar", offset: 72});
    $('a[href*="#"]').on('click', function (e) {
		$('html,body').animate({
			scrollTop: $($(this).attr('href')).offset().top - 71
        }, 800);
		e.preventDefault();
            
	});

    $('li').on('click', function () {
        $(this).addClass('active').siblings().removeClass('active');
    });

    
    /* ========================
        Scroll Top
    ======================== */
    var scrollButton = $(".scroll-top");
    $(window).scroll(function () {
        if ($(this).scrollTop() >= 400) {
            scrollButton.show();
        } else {
            scrollButton.hide();
        }
    });
    scrollButton.on('click', function () {
        $("html,body").animate({
            scrollTop: 0
        }, 2000);
    });
    
    /* ========================
        Toggle Password
    ======================== */
    $(".toggle-password").on('click', function () {
        $(this).toggleClass("fa-eye fa-eye-slash");
        var input = $($(this).attr("data-toggle"));
        if (input.attr("type") == "password") {
            input.attr("type", "text");
        } else {
            input.attr("type", "password");
        }
    });
    /* ========================
        Testimonials
    ======================== */
    $('.owl-carousel').owlCarousel({
        items: 2,
        loop: true,
        margin: 30,
        dots: false,
        autoplay: true,
        responsiveClass: true,
        autoplayHoverPause: true,
        navText: ['<i class="fa fa-chevron-left"></i>', '<i class="fa fa-chevron-right"></i>'],
        responsive: {
            1199: {
                items: 2
            },
            991: {
                items: 1
            },
            767: {
                items: 2
            },
            480: {
                items: 1
            },
            330: {
                items: 1
            }
        }
    });

});

/* ========================
    Accordion
======================== */
$(function () {
	var Accordion = function (el, multiple) {
		this.el = el || {};
		this.multiple = multiple || false;
		var links = this.el.find('.drop-title');
		links.on('click', {el: this.el, multiple: this.multiple}, this.dropdown);
    };
	Accordion.prototype.dropdown = function (e) {
		var $el = e.data.el,
            $this = $(this),
            $next = $this.next();
		$next.slideToggle();
		$this.parent().toggleClass('open');
		if (!e.data.multiple) {
			$el.find('.menu-text').not($next).slideUp().parent().removeClass('open');
		};
	}
    var accordion = new Accordion($('.accordion-list'), false);
});