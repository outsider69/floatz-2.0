import DOM from "../../dom/floatz.dom.dom.js";
import {ScrollPlugin} from "../floatz.scroll.scroller.js";
import {EVENT_CLICK} from "../../dom/floatz.dom.events.js";
import {SCROLL_EVENT_AFTERNAVGIATE, SCROLL_EVENT_BEFORENAVGIATE} from "../floatz.scroll.scroller.js";
import {EVENT_POPSTATE, EVENT_LOAD} from "../../dom/floatz.dom.events.js";

// Constants
const LOG_PREFIX_SCROLLANCHORPLUGIN = "floatz | ScrollAnchorPlugin | ";

/**
 * Scroll anchor plugin.
 * <p>
 *    Adds scroll-to navigation to all scroll anchors.
 * </p>
 */
export class ScrollAnchorPlugin extends ScrollPlugin {

	constructor(options = {}) {
		super(options);

		// Default options
		this.options().anchorsSelector = options.anchorsSelector || ".flz-scroll-anchor";
		this._prepareAnchors();
		this._clickHandlers = [];

		// Scroll on state changes in browser history
		window.addEventListener(EVENT_POPSTATE, (e) => {
			_navigate(this.scroller(), e.state !== null ? e.state.target : "#home", null, false);
		});
	}

	/**
	 * Click anchor handler.
	 *
	 * @param handler Custom handler
	 * @returns {ScrollAnchorPlugin} ScrollAnchorPlugin for chaining
	 */
	onClick(handler) {
		this._clickHandlers.push(handler);
		return this;
	}

	/**
	 * Prepare scroll anchors.
	 *
	 * @return {Array} Scroll anchors
	 * @private
	 */
	_prepareAnchors() {
		let anchors = DOM.query(this.options().anchorsSelector);
		anchors.forEach((anchor) => {
			anchor.addEvent(EVENT_CLICK, (event) => {
				this._handleClick(anchor, event);
			});
		});
		return anchors;
	}

	/**
	 * Handle click on scroll anchor.
	 *
	 * @param anchor Reference to scroll anchor that has been clicked
	 * @param event Click event
	 * @private
	 */
	_handleClick(anchor, event) {
		// Use scroll navigation only when href contains an id
		if (anchor.attr("href").startsWith("#")) {
			_navigate(this.scroller(), anchor.attr("href"), () => {
				event.preventDefault(); // Stop default click behaviour
				event.stopPropagation(); // Stop bubbling the event up the DOM

				// Execute click handlers
				this._clickHandlers
					.forEach(handler => {
						handler(anchor, event);
					})
				;
			});
		}
	}
}

/**
 * Navigate to target
 *
 * @param scroller Scroller
 * @param target Target anchor as href
 * @param action Optional action handler
 * @param updateHistory Optional update history setting (default is true)
 * @private
 */
function _navigate(scroller, target, action, updateHistory = true) {

	// Consider data-id to be used to find scroll target
	let dataIdTarget = _findTargetByDataId(target);
	if(dataIdTarget) {
		target = "#" + dataIdTarget.id();
	}

	let beforeEvent = DOM.createEvent(SCROLL_EVENT_BEFORENAVGIATE, true, true, {
		target: target
	});
	let afterEvent = DOM.createEvent(SCROLL_EVENT_AFTERNAVGIATE, true, false, {
		target: target
	});

	// Fire before navigation event
	if (DOM.dispatchEvent(scroller.container(), beforeEvent)) {

		// Execute action callback
		if (action !== null) {
			action();
		}

		// Scroll to section the menu navigation item points to
		scroller.scrollTo(target, {
			complete: () => {
				if (updateHistory) {
					_updateHistory(target);
				}

				// Fire after navigation event
				DOM.dispatchEvent(scroller.container(), afterEvent);
			},
		});
	}
}

/**
 * Update history.
 *
 * @param target Target anchor
 * @private
 */
function _updateHistory(target) {
	// TODO: Replace url if it contains index.html to avoid having index.html/<target> ...
	let data = {
		target: target
	};

	let element = DOM.queryUnique(target);
	if(element.data("id")) {
		window.history.pushState(data, document.title, "#" + element.data("id"));
	} else {
		window.history.pushState(data, document.title, target);
	}

	if (target.toLowerCase() === "#home") {
		window.history.replaceState(data, document.title, window.location.pathname);
	}

	console.debug(`${LOG_PREFIX_SCROLLANCHORPLUGIN} | Updating history to ${target}`);
}
/**
 * Find target by data-id
 *
 * @param dataId Data id (href)
 * @returns {*} Scroll target or undefined
 * @private
 */
function _findTargetByDataId(dataId) {
	let targets = DOM.query("[data-id]");
	return targets.find((target) => {
		return ("#"+target.data("id")) === dataId;
	});
}