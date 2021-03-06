import DOM from "../dom/floatz.dom.dom.js";
import Easing from "../animation/floatz.animation.easing.js"
import {DOMElement} from "../dom/floatz.dom.dom.js";
import {EVENT_SCROLL} from "../dom/floatz.dom.events.js";
import Strings from "../util/floatz.util.strings.js";

/**
 * Notes:
 * ------
 * document.body.scrollTop / scrollLeft
 * containerElement.scrollTop / scrollLeft
 * childelement.offsetTop / offsetLeft => Position relative to document (fixed)
 * childelement.getClientBoundingRect.top / left => Position relative to _container (variable)
 */

// Constants for events
// Note: Symbols can´t be used because closure compiler will change names
const LOG_PREFIX_SCROLLER = "floatz | Scroller | ";
const LOG_PREFIX_SCROLLANIMATION = "floatz | ScrollAnimation | ";
const LOG_PREFIX_SCROLLPLUGIN = "floatz | ScrollPlugin | ";
export const SCROLL_EVENT_BEFORENAVGIATE = "flz-event-before-navigate";
export const SCROLL_EVENT_AFTERNAVGIATE = "flz-event-after-navigate";

/**
 * Scroll direction enum.
 *
 * @type {Object}
 */
export const Direction = Object.freeze({
	HORIZONTAL: Symbol("horizontal"),
	VERTICAL: Symbol("vertical")
});

/**
 * Scroll manager.
 */
export class Scroller {
	/**
	 * Constructor.
	 *
	 * @param {?(DOMElement|Object|string)} container Scroll container (default is window)
	 * @param {?Object} options Scroll container options
	 */
	constructor(container = window, options = {}) {
		this._options = options;
		this._options.direction = options.direction || Direction.VERTICAL;
		this._options.offset = options.offset || 0;
		this._options.intersection = options.intersection || {};
		this._plugins = [];
		this._handlers = [];
		this._scrollStartHandlers = [];
		this._scrollEndHandlers = [];
		this._scrollInHandlers = [];
		this._scrollOutHandlers = [];
		this._scrollHandler = null;
		this._container = container;
		this._scrolling = false;
		this._observer = null;
		this._firstIntersection = true;

		if (DOM.isWindow(container)) {
			// Note: document.body does not work since Chrome 61
			this._options.scrollable = document.scrollingElement || document.documentElement;
		} else if (container instanceof DOMElement) {
			this._container = container.origNode();
			this._options.scrollable = this._container;
		} else if (Strings.isString(container)) {
			this._container = DOM.queryUnique(container).origNode();
			this._options.scrollable = this._container;
		} else {
			this._options.scrollable = this._container;
		}

		this._options.intersection.threshold = options.intersection.threshold || [0.1]; // Ensure firing at 0 and 100% visibility
		this._options.intersection.rootMargin = options.intersection.rootMargin;
		if (options.intersection.root) {
			this._options.intersection.root = options.intersection.root;
		} else if (!DOM.isWindow(this._container)) {
			this._options.intersection.root = this._container;
		}

		this._prevScrollPos = this.scrollPos();
	}

	/**
	 * Inject scroll plugin.
	 *
	 * @param plugin {ScrollPlugin} Scroll plugin
	 * @returns {Scroller} Scroller for chaining
	 */
	plugin(plugin) {
		if (!(plugin instanceof ScrollPlugin)) {
			throw "Plugin must extend class ScrollPlugin";
		}

		plugin.scroller(this);
		this._plugins.push(plugin);
		this.onScroll(() => {
			plugin.onScroll(this);
		});
		this.onScrollBackward(() => {
			plugin.onScrollBackward(this);
		});
		this.onScrollForward(() => {
			plugin.onScrollForward(this);
		});
		return this;
	}

	/**
	 * Get scroll container.
	 *
	 * @returns {!Element} Scroll container
	 */
	container() {
		return this._container;
	}

	/**
	 * Get scroll options.
	 *
	 * @returns Scroll options
	 */
	options() {
		return this._options;
	}

	/**
	 * Get / set scroll offset correction.
	 *
	 * @param {number=} offset Scroll offset correction
	 * @returns Scroller for chaining when used as setter
	 */
	offset(offset) {
		if (offset === undefined) {
			return this._options.offset;
		} else {
			this._options.offset = offset;
			return this;
		}
	}

	/**
	 * Scroll handler.
	 *
	 * @param {Function} handler Custom handler
	 * @returns {Scroller} Scroller for chaining
	 */
	onScroll(handler) {
		if (!this._scrollHandler) {
			this._scrollHandler = () => {
				// Adjust events to maximum of 60fps
				if (!this._scrolling) {
					window.requestAnimationFrame(() => {
						this._handlers.forEach((handler) => {
							handler(this);
						});

						// Set new position AFTER firing handlers!
						this._prevScrollPos = this.scrollPos();
						this._scrolling = false;
					});
					this._scrolling = true;
				}
			};
			DOM.addEvent(this._container, EVENT_SCROLL, this._scrollHandler);
		}

		this._handlers.push(() => {
			handler(this);
		});
		return this;
	}

	/**
	 * Scroll forward handler.
	 *
	 * @param {Function} handler Custom handler
	 * @returns {Scroller} Scroller for chaining
	 */
	onScrollForward(handler) {
		this._handlers.push(() => {
			if (this._prevScrollPos < this.scrollPos()) {
				handler(this);
			}
		});
		return this;
	}

	/**
	 * Scroll backward handler.
	 *
	 * @param {Function} handler Custom handler
	 * @returns {Scroller} Scroller for chaining
	 */
	onScrollBackward(handler) {
		this._handlers.push(() => {
			if (this._prevScrollPos > this.scrollPos()) {
				handler(this);
			}
		});
		return this;
	}

	/**
	 * Scroll start handler.
	 *
	 * @param {Function} handler Custom handler
	 * @returns {Scroller} Scroller for chaining
	 */
	onScrollStart(handler) {
		_registerScrollStartEndHandler(this);
		this._scrollStartHandlers.push(() => {
			handler(this);
		});
		return this;
	}

	/**
	 * Scroll end handler.
	 *
	 * @param {Function} handler Custom handler
	 * @returns {Scroller} Scroller for chaining
	 */
	onScrollEnd(handler) {
		_registerScrollStartEndHandler(this);
		this._scrollEndHandlers.push(() => {
			handler(this);
		});
		return this;
	}

	/**
	 * Scroll into viewport handler.
	 * <p>
	 *     The registered handler is executed as soon as the target element scrolls into the viewport.
	 *     TODO: Consider custom thresholds
	 *     TODO: Multiple targets (Array)
	 *     TODO: String selector as target
	 *     TODO: Node as target
	 * </p>
	 *
	 * @param {DOMElement|Array} target Observed target element(s)
	 * @param {Function} handler Custom handler
	 * @returns {Scroller} Scroller for chaining
	 */
	onScrollIn(target, handler) {
		_initIntersectionObserver(this, target);
		let targets = Array.isArray(target) ? target : new Array(target);
		targets.forEach((target) => {
			this._scrollInHandlers.push({
				target: target,
				handler: handler
			});
		});
		return this;
	}

	/**
	 * Scroll out of viewport handler.
	 * <p>
	 *     The registered handler is executed as soon as the target element scrolls out of the viewport.
	 *     TODO: Consider custom thresholds
	 *     TODO: Multiple targets (Array)
	 *     TODO: String selector as target
	 *     TODO: Node as target
	 * </p>
	 *
	 * @param {DOMElement|Array} target Observed target element(s)
	 * @param {Function} handler Custom handler
	 * @returns {Scroller} Scroller for chaining
	 */
	onScrollOut(target, handler) {
		_initIntersectionObserver(this, target);
		let targets = Array.isArray(target) ? target : new Array(target);
		targets.forEach((target) => {
			this._scrollOutHandlers.push({
				target: target,
				handler: handler
			});
		});
		return this;
	}

	/**
	 * Scroll to
	 * @param {(Object|string)} target Target element or position
	 * @param {Object=} options Scroll options
	 * @returns {Scroller} Scroller for chaining
	 */
	scrollTo(target, options = {}) {
		this._options.duration = options.duration || 600;
		this._options.easing = options.easing || Easing.easeInOutQuad;
		this._options.complete = options.complete || null;
		new ScrollAnimation(this._container, target, this._options);
		return this;
	}

	/**
	 * Get scroll direction configure via the constructor.
	 *
	 * @return {Object} direction Scroll Direction
	 */
	direction() {
		return this._options.direction;
	}

	/**
	 * Get scroll position.
	 *
	 * @param {number=} position Optional scroll position
	 * @returns {number|Scroller} Scroll position in px or scroller for chaining if used as setter
	 */
	scrollPos(position) {
		if (position) {
			console.log(position);
			if (this.direction() === Direction.VERTICAL) {
				this._options.scrollable.scrollTop = position;
			} else {
				this._options.scrollable.scrollLeft = position;
			}
			return this;
		} else {
			return this.direction() === Direction.VERTICAL ? this._options.scrollable.scrollTop : this._options.scrollable.scrollLeft;
		}
	}

	/**
	 * Get previous scroll position.
	 *
	 * @returns {*|number} Previous scroll position in px
	 */
	prevScrollPos() {
		return this._prevScrollPos;
	}

	/**
	 * Get size of scroll container (including all its scroll sections)
	 *
	 * @returns {number} Scroll container size in px
	 */
	scrollSize() {
		if (this.direction() === Direction.VERTICAL) {
			return this._options.scrollable.scrollHeight;
		} else {
			return this._options.scrollable.scrollWidth;
		}
	}

	/**
	 * Get size of scroll container viewport.
	 * @returns {number} Scroll container viewport size in px
	 */
	viewportSize() {
		if (this.direction() === Direction.VERTICAL) {
			if (DOM.isWindow(this._container)) {
				return this._container.innerHeight;
			} else {
				return this._container.getBoundingClientRect().height;
			}
		} else {
			if (DOM.isWindow(this._container)) {
				return this._container.innerWidth;
			} else {
				return this._container.getBoundingClientRect().width;
			}
		}
	}
}

/**
 * Scroll animation.
 *
 * Inspired by:
 * http://callmecavs.com/jump.js/
 */
export class ScrollAnimation {

	/**
	 * Constructor.
	 *
	 * @param {Object} container Scroll container
	 * @param {(string|Object)} target Target element or position
	 * @param {Object} options Scroll options
	 */
	constructor(container, target, options) {
		this._container = null;      // Scroll container
		this._options = null;        // Scroll configuration
		this._element = null;        // Scroll target DOMElement
		this._start = null;          // Scroll start position in px
		this._stop = null;           // Scroll stop position in px
		this._distance = null;       // Scroll distance in px
		this._timeStart = null;      // Scroll start time in ms
		this._timeElapsed = null;    // Scroll time already elapsed ms
		this._next = null;           // Next scroll position in px

		this._container = container;
		this._options = options;

		// Convert target to DOMElement
		this._element = this.element(target);

		// Get start position
		this._start = this.startPos();

		// Get stop position
		this._stop = this.stopPos(target);

		// Get distance
		this._distance = this._stop - this._start + this._options.offset;
		// console.debug(`target: ${target}, stop: ${this._stop}, start: ${this._start}, offset: ${this._options.offset}, distance: ${this._distance}`);

		// Start scroll animation
		// Note: the arrow function sets context for usage of this in animate
		window.requestAnimationFrame((t) => this.animate(t));
	}

	/**
	 * Get start position.
	 *
	 * @returns {(number)} Start position
	 */
	startPos() {
		// Get scroll _start position depending on scroll direction
		if (this._options.direction === Direction.VERTICAL) {
			return this._options.scrollable.scrollTop;
		} else {
			return this._options.scrollable.scrollLeft;
		}
	}

	/**
	 * Get stop position
	 *
	 * @param {(DOMElement|Object|string|number)} target Scroll target
	 * @returns {number} Stop position in px
	 */
	stopPos(target) {
		if (typeof target === 'number') {
			// Just use the px position of the target
			return target;
		} else {
			// Get scroll stop position depending on scroll direction
			if (this._options.direction === Direction.VERTICAL) {
				return this._element.origNode().getBoundingClientRect().top + this._start;
			} else {
				return this._element.origNode().getBoundingClientRect().left + this._start;
			}
		}
	}

	// noinspection JSMethodCanBeStatic
	/**
	 * Convert target to DOMElement.
	 *
	 * @param {(DOMElement|Object|string)} target Target element or position
	 * @returns {*} DOMElement
	 */
	element(target) {
		let element = null;
		switch (typeof target) {
			case 'object':
				if(target instanceof DOMElement) {
					element = target;
				} else {
					element = new DOMElement(target);
				}
				break;
			case 'string':
				element = DOM.queryUnique(target);
				break;
		}
		return element;
	}

	/**
	 * Run scroll animation.
	 *
	 * @param {number} timeCurrent Current time from in µs
	 */
	animate(timeCurrent) {

		// Remember time when scrolling started
		if (!this._timeStart) {
			this._timeStart = timeCurrent;
		}

		// Determine time spent for scrolling so far
		this._timeElapsed = timeCurrent - this._timeStart;

		// Calculate _next scroll position
		this._next = this._options.easing(this._timeElapsed, this._start, this._distance,
			this._options.duration);

		// Change scroll position
		this.scroll(this._next);

		// Check progress
		if (this._timeElapsed < this._options.duration) {
			// Continue scroll animation
			// Note: the arrow function sets context for usage of this in animate
			window.requestAnimationFrame((t) => this.animate(t));
		} else {
			// Finish scroll animation
			this.done();
		}
	}

	/**
	 * Scroll to position.
	 *
	 * @param {number} position Scroll position
	 */
	scroll(position) {
		if (this._options.direction === Direction.VERTICAL) {
			this._options.scrollable.scrollTop = position;
		} else {
			this._options.scrollable.scrollLeft = position;
		}
	}

	/**
	 * Finish scroll animation.
	 */
	done() {
		// Account for time rounding inaccuracies in requestAnimationFrame
		this.scroll(this._start + this._distance);

		// Reset time for _next animation
		this._timeStart = false;

		// Run custom complete function if available
		if (this._options.complete !== null) {
			this._options.complete();
		}
	}
}

/**
 * Scroller plugin.
 */
export class ScrollPlugin {

	/**
	 * Constructor.
	 * @param {Object=} options Options
	 */
	constructor(options = {}) {
		this._scroller = null;
		this._options = options;
	}

	/**
	 * Get / set scroller.
	 *
	 * @param {Scroller=} scroller
	 * @returns {(Scroller|ScrollPlugin)} Scroller or ScrollPlugin for chaining when used as setter
	 */
	scroller(scroller) {
		if (scroller) {
			this._scroller = scroller;
			return this;
		} else {
			return this._scroller;
		}
	}

	/**
	 * Get options.
	 *
	 * @returns {Object}
	 */
	options() {
		return this._options;
	}

	/**
	 * Scroll handler.
	 */
	onScroll() {
	}

	/**
	 * Scroll backward handler.
	 */
	onScrollBackward() {
	}

	/**
	 * Scroll forward handler.
	 */
	onScrollForward() {
	}
}

/**
 * Register handler that is necessary for scroll start / end events.
 *
 * @param {Scroller} scroller Scroller
 * @see https://gomakethings.com/detecting-when-a-visitor-has-stopped-scrolling-with-vanilla-javascript/
 * @private
 */
function _registerScrollStartEndHandler(scroller) {
	if (scroller._scrollEndHandlers.length === 0 && scroller._scrollStartHandlers.length === 0) {
		let isScrolling = null;
		DOM.addEvent(scroller._container, EVENT_SCROLL, () => {

			// Run scroll start handlers
			if (isScrolling === null) {
				scroller._scrollStartHandlers.forEach((handler) => {
					handler(scroller);
				});
			}

			// Clear our timeout throughout the scroll
			window.clearTimeout(isScrolling);

			// Set a timeout to run after scrolling ends
			isScrolling = setTimeout(() => {

				// Run scroll end handlers
				scroller._scrollEndHandlers.forEach((handler) => {
					handler(scroller);
				});
				isScrolling = null;

			}, 100); // Scrolling on iOS needs more time otherwise flickers!
		});
	}
}

/**
 * Initialize intersection observer.
 * <p>
 *     Ensures that only one intersection observer is created and the observed target handler is registered.
 * </p>
 *
 * @param {Scroller} scroller Scroller
 * @param {DOMElement|Array} target Observed target element(s)
 * @private
 */
function _initIntersectionObserver(scroller, target) {
	if (scroller._observer === null) {
		// FIXME Consider fixed header offsets
		scroller._observer = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) {
					// Run scroll-in handlers
					scroller._scrollInHandlers.filter(handler => handler.target.origNode() === entry.target)
						.forEach((handler) => {
							handler.handler(entry);
						})
					;

				} else if (!scroller._firstIntersection) { // Don´t fire scroll-out on first run when they were never visible
					// Run scroll-out handlers
					scroller._scrollOutHandlers.filter(handler => handler.target.origNode() === entry.target)
						.forEach((handler) => {
							handler.handler(entry);
						})
					;
				}
			});
			scroller._firstIntersection = false;
		}, {
			root: scroller.options().intersection.root,
			rootMargin : scroller.options().intersection.rootMargin,
			threshold: scroller.options().intersection.threshold
		});
	}

	// TODO: Check what happens if same target is observed multiple times
	let targets = Array.isArray(target) ? target : new Array(target);
	targets.forEach((target) => {
		scroller._observer.observe(target.origNode());
	});
}
