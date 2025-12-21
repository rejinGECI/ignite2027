// Navigation module
export function createNavigationModule(app) {
    return {
        setupNavigation: function() {
            const navLinks = document.querySelectorAll('.nav-link[data-page]');
            navLinks.forEach(link => {
                // Remove onclick if present
                if (link.hasAttribute('onclick')) {
                    link.removeAttribute('onclick');
                }
                
                const handleNavClick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const page = link.getAttribute('data-page');
                    if (page) {
                        app.showPage(page);
                        // Close mobile menu after navigation
                        app.closeMobileMenu();
                    }
                };
                
                // Add both click and touch events for mobile support
                link.addEventListener('click', handleNavClick, { passive: false });
                link.addEventListener('touchend', handleNavClick, { passive: false });
            });

            // Mobile menu toggle
            const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
            const navbar = document.getElementById('navbar');
            
            if (mobileMenuToggle && navbar) {
                const handleToggle = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    app.toggleMobileMenu();
                };
                
                // Add both click and touch events
                mobileMenuToggle.addEventListener('click', handleToggle, { passive: false });
                mobileMenuToggle.addEventListener('touchend', handleToggle, { passive: false });

                // Close menu when clicking backdrop or outside
                const backdrop = document.getElementById('mobile-menu-backdrop');
                if (backdrop) {
                    const handleBackdropClick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        app.closeMobileMenu();
                    };
                    
                    backdrop.addEventListener('click', handleBackdropClick, { passive: false });
                    backdrop.addEventListener('touchend', handleBackdropClick, { passive: false });
                }
                
                // Handle outside clicks/touches
                const handleOutsideClick = (e) => {
                    if (navbar.classList.contains('mobile-open') && 
                        !navbar.contains(e.target) && 
                        !mobileMenuToggle.contains(e.target) &&
                        !(backdrop && backdrop.contains(e.target))) {
                        app.closeMobileMenu();
                    }
                };
                
                document.addEventListener('click', handleOutsideClick);
                document.addEventListener('touchend', handleOutsideClick);

                // Close menu on window resize (if resizing to desktop)
                window.addEventListener('resize', () => {
                    if (window.innerWidth > 768) {
                        app.closeMobileMenu();
                    }
                });
            }
        },

        toggleMobileMenu: function() {
            const navbar = document.getElementById('navbar');
            const toggle = document.getElementById('mobile-menu-toggle');
            const backdrop = document.getElementById('mobile-menu-backdrop');
            if (navbar && toggle) {
                navbar.classList.toggle('mobile-open');
                const icon = toggle.querySelector('i');
                if (icon) {
                    if (navbar.classList.contains('mobile-open')) {
                        icon.classList.remove('fa-bars');
                        icon.classList.add('fa-times');
                        if (backdrop) backdrop.classList.add('active');
                        document.body.classList.add('mobile-menu-open');
                    } else {
                        icon.classList.remove('fa-times');
                        icon.classList.add('fa-bars');
                        if (backdrop) backdrop.classList.remove('active');
                        document.body.classList.remove('mobile-menu-open');
                    }
                }
            }
        },

        closeMobileMenu: function() {
            const navbar = document.getElementById('navbar');
            const toggle = document.getElementById('mobile-menu-toggle');
            const backdrop = document.getElementById('mobile-menu-backdrop');
            if (navbar && toggle) {
                navbar.classList.remove('mobile-open');
                const icon = toggle.querySelector('i');
                if (icon) {
                    icon.classList.remove('fa-times');
                    icon.classList.add('fa-bars');
                }
                if (backdrop) backdrop.classList.remove('active');
                document.body.classList.remove('mobile-menu-open');
            }
        },
        
        showPageLoader: function(pageId, show = true) {
            const page = document.getElementById(pageId);
            if (!page) return;
            
            let loader = page.querySelector('.page-loader');
            
            if (show) {
                if (!loader) {
                    // Create loader if it doesn't exist
                    loader = document.createElement('div');
                    loader.className = 'page-loader';
                    loader.innerHTML = `
                        <div class="page-loader-content">
                            <div class="spinner-enhanced">
                                <div class="spinner-dot"></div>
                            </div>
                            <div class="page-loader-text">Loading...</div>
                        </div>
                    `;
                    page.appendChild(loader);
                } else {
                    loader.classList.remove('hidden');
                }
            } else {
                if (loader) {
                    // Fade out then hide
                    loader.classList.add('hidden');
                    setTimeout(() => {
                        if (loader && loader.parentNode) {
                            loader.remove();
                        }
                    }, 300);
                }
            }
        }
    };
}

