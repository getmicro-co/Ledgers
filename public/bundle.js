var app = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function null_to_empty(value) {
        return value == null ? '' : value;
    }
    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        if (node.parentNode) {
            node.parentNode.removeChild(node);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, bubbles, cancelable, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    /**
     * The `onMount` function schedules a callback to run as soon as the component has been mounted to the DOM.
     * It must be called during the component's initialisation (but doesn't need to live *inside* the component;
     * it can be called from an external module).
     *
     * `onMount` does not run inside a [server-side component](/docs#run-time-server-side-component-api).
     *
     * https://svelte.dev/docs#run-time-svelte-onmount
     */
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }
    /**
     * Creates an event dispatcher that can be used to dispatch [component events](/docs#template-syntax-component-directives-on-eventname).
     * Event dispatchers are functions that can take two arguments: `name` and `detail`.
     *
     * Component events created with `createEventDispatcher` create a
     * [CustomEvent](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent).
     * These events do not [bubble](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Building_blocks/Events#Event_bubbling_and_capture).
     * The `detail` argument corresponds to the [CustomEvent.detail](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent/detail)
     * property and can contain any type of data.
     *
     * https://svelte.dev/docs#run-time-svelte-createeventdispatcher
     */
    function createEventDispatcher() {
        const component = get_current_component();
        return (type, detail, { cancelable = false } = {}) => {
            const callbacks = component.$$.callbacks[type];
            if (callbacks) {
                // TODO are there situations where events could be dispatched
                // in a server (non-DOM) environment?
                const event = custom_event(type, detail, { cancelable });
                callbacks.slice().forEach(fn => {
                    fn.call(component, event);
                });
                return !event.defaultPrevented;
            }
            return true;
        };
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    // flush() calls callbacks in this order:
    // 1. All beforeUpdate callbacks, in order: parents before children
    // 2. All bind:this callbacks, in reverse order: children before parents.
    // 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
    //    for afterUpdates called during the initial onMount, which are called in
    //    reverse order: children before parents.
    // Since callbacks might update component values, which could trigger another
    // call to flush(), the following steps guard against this:
    // 1. During beforeUpdate, any updated components will be added to the
    //    dirty_components array and will cause a reentrant call to flush(). Because
    //    the flush index is kept outside the function, the reentrant call will pick
    //    up where the earlier call left off and go through all dirty components. The
    //    current_component value is saved and restored so that the reentrant call will
    //    not interfere with the "parent" flush() call.
    // 2. bind:this callbacks cannot trigger new flush() calls.
    // 3. During afterUpdate, any updated components will NOT have their afterUpdate
    //    callback called a second time; the seen_callbacks set, outside the flush()
    //    function, guarantees this behavior.
    const seen_callbacks = new Set();
    let flushidx = 0; // Do *not* move this inside the flush() function
    function flush() {
        // Do not reenter flush while dirty components are updated, as this can
        // result in an infinite loop. Instead, let the inner flush handle it.
        // Reentrancy is ok afterwards for bindings etc.
        if (flushidx !== 0) {
            return;
        }
        const saved_component = current_component;
        do {
            // first, call beforeUpdate functions
            // and update components
            try {
                while (flushidx < dirty_components.length) {
                    const component = dirty_components[flushidx];
                    flushidx++;
                    set_current_component(component);
                    update(component.$$);
                }
            }
            catch (e) {
                // reset dirty state to not end up in a deadlocked state and then rethrow
                dirty_components.length = 0;
                flushidx = 0;
                throw e;
            }
            set_current_component(null);
            dirty_components.length = 0;
            flushidx = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        seen_callbacks.clear();
        set_current_component(saved_component);
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
        else if (callback) {
            callback();
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
                // if the component was destroyed immediately
                // it will update the `$$.on_destroy` reference to `null`.
                // the destructured on_destroy may still reference to the old array
                if (component.$$.on_destroy) {
                    component.$$.on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: [],
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            if (!is_function(callback)) {
                return noop;
            }
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, Object.assign({ version: '3.55.1' }, detail), { bubbles: true }));
    }
    function append_dev(target, node) {
        dispatch_dev('SvelteDOMInsert', { target, node });
        append(target, node);
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev('SvelteDOMInsert', { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev('SvelteDOMRemove', { node });
        detach(node);
    }
    function listen_dev(node, event, handler, options, has_prevent_default, has_stop_propagation) {
        const modifiers = options === true ? ['capture'] : options ? Array.from(Object.keys(options)) : [];
        if (has_prevent_default)
            modifiers.push('preventDefault');
        if (has_stop_propagation)
            modifiers.push('stopPropagation');
        dispatch_dev('SvelteDOMAddEventListener', { node, event, handler, modifiers });
        const dispose = listen(node, event, handler, options);
        return () => {
            dispatch_dev('SvelteDOMRemoveEventListener', { node, event, handler, modifiers });
            dispose();
        };
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev('SvelteDOMRemoveAttribute', { node, attribute });
        else
            dispatch_dev('SvelteDOMSetAttribute', { node, attribute, value });
    }
    function validate_slots(name, slot, keys) {
        for (const slot_key of Object.keys(slot)) {
            if (!~keys.indexOf(slot_key)) {
                console.warn(`<${name}> received an unexpected slot "${slot_key}".`);
            }
        }
    }
    /**
     * Base class for Svelte components with some minor dev-enhancements. Used when dev=true.
     */
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error("'target' is a required option");
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn('Component was already destroyed'); // eslint-disable-line no-console
            };
        }
        $capture_state() { }
        $inject_state() { }
    }

    function t(t,n){for(var e=0;e<n.length;e++){var r=n[e];r.enumerable=r.enumerable||!1,r.configurable=!0,"value"in r&&(r.writable=!0),Object.defineProperty(t,"symbol"==typeof(o=function(t,n){if("object"!=typeof t||null===t)return t;var e=t[Symbol.toPrimitive];if(void 0!==e){var r=e.call(t,"string");if("object"!=typeof r)return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)}(r.key))?o:String(o),r);}var o;}function n(n,e,r){return e&&t(n.prototype,e),r&&t(n,r),Object.defineProperty(n,"prototype",{writable:!1}),n}function e(){return e=Object.assign?Object.assign.bind():function(t){for(var n=1;n<arguments.length;n++){var e=arguments[n];for(var r in e)Object.prototype.hasOwnProperty.call(e,r)&&(t[r]=e[r]);}return t},e.apply(this,arguments)}function r(t,n){t.prototype=Object.create(n.prototype),t.prototype.constructor=t,o(t,n);}function o(t,n){return o=Object.setPrototypeOf?Object.setPrototypeOf.bind():function(t,n){return t.__proto__=n,t},o(t,n)}function i(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function u(t,n){(null==n||n>t.length)&&(n=t.length);for(var e=0,r=new Array(n);e<n;e++)r[e]=t[e];return r}function s(t,n){var e="undefined"!=typeof Symbol&&t[Symbol.iterator]||t["@@iterator"];if(e)return (e=e.call(t)).next.bind(e);if(Array.isArray(t)||(e=function(t,n){if(t){if("string"==typeof t)return u(t,n);var e=Object.prototype.toString.call(t).slice(8,-1);return "Object"===e&&t.constructor&&(e=t.constructor.name),"Map"===e||"Set"===e?Array.from(t):"Arguments"===e||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(e)?u(t,n):void 0}}(t))||n&&t&&"number"==typeof t.length){e&&(t=e);var r=0;return function(){return r>=t.length?{done:!0}:{done:!1,value:t[r++]}}}throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}var a;!function(t){t[t.Init=0]="Init",t[t.Loading=1]="Loading",t[t.Loaded=2]="Loaded",t[t.Rendered=3]="Rendered",t[t.Error=4]="Error";}(a||(a={}));var l,c,f,p,d,h,_,m={},v=[],g=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;function y(t,n){for(var e in n)t[e]=n[e];return t}function b(t){var n=t.parentNode;n&&n.removeChild(t);}function w(t,n,e){var r,o,i,u={};for(i in n)"key"==i?r=n[i]:"ref"==i?o=n[i]:u[i]=n[i];if(arguments.length>2&&(u.children=arguments.length>3?l.call(arguments,2):e),"function"==typeof t&&null!=t.defaultProps)for(i in t.defaultProps)void 0===u[i]&&(u[i]=t.defaultProps[i]);return x(t,u,r,o,null)}function x(t,n,e,r,o){var i={type:t,props:n,key:e,ref:r,__k:null,__:null,__b:0,__e:null,__d:void 0,__c:null,__h:null,constructor:void 0,__v:null==o?++f:o};return null==o&&null!=c.vnode&&c.vnode(i),i}function S(t){return t.children}function N(t,n){this.props=t,this.context=n;}function C(t,n){if(null==n)return t.__?C(t.__,t.__.__k.indexOf(t)+1):null;for(var e;n<t.__k.length;n++)if(null!=(e=t.__k[n])&&null!=e.__e)return e.__e;return "function"==typeof t.type?C(t):null}function P(t){var n,e;if(null!=(t=t.__)&&null!=t.__c){for(t.__e=t.__c.base=null,n=0;n<t.__k.length;n++)if(null!=(e=t.__k[n])&&null!=e.__e){t.__e=t.__c.base=e.__e;break}return P(t)}}function E(t){(!t.__d&&(t.__d=!0)&&d.push(t)&&!I.__r++||h!==c.debounceRendering)&&((h=c.debounceRendering)||setTimeout)(I);}function I(){for(var t;I.__r=d.length;)t=d.sort(function(t,n){return t.__v.__b-n.__v.__b}),d=[],t.some(function(t){var n,e,r,o,i,u;t.__d&&(i=(o=(n=t).__v).__e,(u=n.__P)&&(e=[],(r=y({},o)).__v=o.__v+1,F(u,o,r,n.__n,void 0!==u.ownerSVGElement,null!=o.__h?[i]:null,e,null==i?C(o):i,o.__h),O(e,o),o.__e!=i&&P(o)));});}function T(t,n,e,r,o,i,u,s,a,l){var c,f,p,d,h,_,g,y=r&&r.__k||v,b=y.length;for(e.__k=[],c=0;c<n.length;c++)if(null!=(d=e.__k[c]=null==(d=n[c])||"boolean"==typeof d?null:"string"==typeof d||"number"==typeof d||"bigint"==typeof d?x(null,d,null,null,d):Array.isArray(d)?x(S,{children:d},null,null,null):d.__b>0?x(d.type,d.props,d.key,d.ref?d.ref:null,d.__v):d)){if(d.__=e,d.__b=e.__b+1,null===(p=y[c])||p&&d.key==p.key&&d.type===p.type)y[c]=void 0;else for(f=0;f<b;f++){if((p=y[f])&&d.key==p.key&&d.type===p.type){y[f]=void 0;break}p=null;}F(t,d,p=p||m,o,i,u,s,a,l),h=d.__e,(f=d.ref)&&p.ref!=f&&(g||(g=[]),p.ref&&g.push(p.ref,null,d),g.push(f,d.__c||h,d)),null!=h?(null==_&&(_=h),"function"==typeof d.type&&d.__k===p.__k?d.__d=a=L(d,a,t):a=A(t,d,p,y,h,a),"function"==typeof e.type&&(e.__d=a)):a&&p.__e==a&&a.parentNode!=t&&(a=C(p));}for(e.__e=_,c=b;c--;)null!=y[c]&&W(y[c],y[c]);if(g)for(c=0;c<g.length;c++)U(g[c],g[++c],g[++c]);}function L(t,n,e){for(var r,o=t.__k,i=0;o&&i<o.length;i++)(r=o[i])&&(r.__=t,n="function"==typeof r.type?L(r,n,e):A(e,r,r,o,r.__e,n));return n}function A(t,n,e,r,o,i){var u,s,a;if(void 0!==n.__d)u=n.__d,n.__d=void 0;else if(null==e||o!=i||null==o.parentNode)t:if(null==i||i.parentNode!==t)t.appendChild(o),u=null;else {for(s=i,a=0;(s=s.nextSibling)&&a<r.length;a+=1)if(s==o)break t;t.insertBefore(o,i),u=i;}return void 0!==u?u:o.nextSibling}function H(t,n,e){"-"===n[0]?t.setProperty(n,e):t[n]=null==e?"":"number"!=typeof e||g.test(n)?e:e+"px";}function j(t,n,e,r,o){var i;t:if("style"===n)if("string"==typeof e)t.style.cssText=e;else {if("string"==typeof r&&(t.style.cssText=r=""),r)for(n in r)e&&n in e||H(t.style,n,"");if(e)for(n in e)r&&e[n]===r[n]||H(t.style,n,e[n]);}else if("o"===n[0]&&"n"===n[1])i=n!==(n=n.replace(/Capture$/,"")),n=n.toLowerCase()in t?n.toLowerCase().slice(2):n.slice(2),t.l||(t.l={}),t.l[n+i]=e,e?r||t.addEventListener(n,i?M:D,i):t.removeEventListener(n,i?M:D,i);else if("dangerouslySetInnerHTML"!==n){if(o)n=n.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if("href"!==n&&"list"!==n&&"form"!==n&&"tabIndex"!==n&&"download"!==n&&n in t)try{t[n]=null==e?"":e;break t}catch(t){}"function"==typeof e||(null==e||!1===e&&-1==n.indexOf("-")?t.removeAttribute(n):t.setAttribute(n,e));}}function D(t){this.l[t.type+!1](c.event?c.event(t):t);}function M(t){this.l[t.type+!0](c.event?c.event(t):t);}function F(t,n,e,r,o,i,u,s,a){var l,f,p,d,h,_,m,v,g,b,w,x,k,C,P,E=n.type;if(void 0!==n.constructor)return null;null!=e.__h&&(a=e.__h,s=n.__e=e.__e,n.__h=null,i=[s]),(l=c.__b)&&l(n);try{t:if("function"==typeof E){if(v=n.props,g=(l=E.contextType)&&r[l.__c],b=l?g?g.props.value:l.__:r,e.__c?m=(f=n.__c=e.__c).__=f.__E:("prototype"in E&&E.prototype.render?n.__c=f=new E(v,b):(n.__c=f=new N(v,b),f.constructor=E,f.render=B),g&&g.sub(f),f.props=v,f.state||(f.state={}),f.context=b,f.__n=r,p=f.__d=!0,f.__h=[],f._sb=[]),null==f.__s&&(f.__s=f.state),null!=E.getDerivedStateFromProps&&(f.__s==f.state&&(f.__s=y({},f.__s)),y(f.__s,E.getDerivedStateFromProps(v,f.__s))),d=f.props,h=f.state,p)null==E.getDerivedStateFromProps&&null!=f.componentWillMount&&f.componentWillMount(),null!=f.componentDidMount&&f.__h.push(f.componentDidMount);else {if(null==E.getDerivedStateFromProps&&v!==d&&null!=f.componentWillReceiveProps&&f.componentWillReceiveProps(v,b),!f.__e&&null!=f.shouldComponentUpdate&&!1===f.shouldComponentUpdate(v,f.__s,b)||n.__v===e.__v){for(f.props=v,f.state=f.__s,n.__v!==e.__v&&(f.__d=!1),f.__v=n,n.__e=e.__e,n.__k=e.__k,n.__k.forEach(function(t){t&&(t.__=n);}),w=0;w<f._sb.length;w++)f.__h.push(f._sb[w]);f._sb=[],f.__h.length&&u.push(f);break t}null!=f.componentWillUpdate&&f.componentWillUpdate(v,f.__s,b),null!=f.componentDidUpdate&&f.__h.push(function(){f.componentDidUpdate(d,h,_);});}if(f.context=b,f.props=v,f.__v=n,f.__P=t,x=c.__r,k=0,"prototype"in E&&E.prototype.render){for(f.state=f.__s,f.__d=!1,x&&x(n),l=f.render(f.props,f.state,f.context),C=0;C<f._sb.length;C++)f.__h.push(f._sb[C]);f._sb=[];}else do{f.__d=!1,x&&x(n),l=f.render(f.props,f.state,f.context),f.state=f.__s;}while(f.__d&&++k<25);f.state=f.__s,null!=f.getChildContext&&(r=y(y({},r),f.getChildContext())),p||null==f.getSnapshotBeforeUpdate||(_=f.getSnapshotBeforeUpdate(d,h)),P=null!=l&&l.type===S&&null==l.key?l.props.children:l,T(t,Array.isArray(P)?P:[P],n,e,r,o,i,u,s,a),f.base=n.__e,n.__h=null,f.__h.length&&u.push(f),m&&(f.__E=f.__=null),f.__e=!1;}else null==i&&n.__v===e.__v?(n.__k=e.__k,n.__e=e.__e):n.__e=R(e.__e,n,e,r,o,i,u,a);(l=c.diffed)&&l(n);}catch(t){n.__v=null,(a||null!=i)&&(n.__e=s,n.__h=!!a,i[i.indexOf(s)]=null),c.__e(t,n,e);}}function O(t,n){c.__c&&c.__c(n,t),t.some(function(n){try{t=n.__h,n.__h=[],t.some(function(t){t.call(n);});}catch(t){c.__e(t,n.__v);}});}function R(t,n,e,r,o,i,u,s){var a,c,f,p=e.props,d=n.props,h=n.type,_=0;if("svg"===h&&(o=!0),null!=i)for(;_<i.length;_++)if((a=i[_])&&"setAttribute"in a==!!h&&(h?a.localName===h:3===a.nodeType)){t=a,i[_]=null;break}if(null==t){if(null===h)return document.createTextNode(d);t=o?document.createElementNS("http://www.w3.org/2000/svg",h):document.createElement(h,d.is&&d),i=null,s=!1;}if(null===h)p===d||s&&t.data===d||(t.data=d);else {if(i=i&&l.call(t.childNodes),c=(p=e.props||m).dangerouslySetInnerHTML,f=d.dangerouslySetInnerHTML,!s){if(null!=i)for(p={},_=0;_<t.attributes.length;_++)p[t.attributes[_].name]=t.attributes[_].value;(f||c)&&(f&&(c&&f.__html==c.__html||f.__html===t.innerHTML)||(t.innerHTML=f&&f.__html||""));}if(function(t,n,e,r,o){var i;for(i in e)"children"===i||"key"===i||i in n||j(t,i,null,e[i],r);for(i in n)o&&"function"!=typeof n[i]||"children"===i||"key"===i||"value"===i||"checked"===i||e[i]===n[i]||j(t,i,n[i],e[i],r);}(t,d,p,o,s),f)n.__k=[];else if(_=n.props.children,T(t,Array.isArray(_)?_:[_],n,e,r,o&&"foreignObject"!==h,i,u,i?i[0]:e.__k&&C(e,0),s),null!=i)for(_=i.length;_--;)null!=i[_]&&b(i[_]);s||("value"in d&&void 0!==(_=d.value)&&(_!==t.value||"progress"===h&&!_||"option"===h&&_!==p.value)&&j(t,"value",_,p.value,!1),"checked"in d&&void 0!==(_=d.checked)&&_!==t.checked&&j(t,"checked",_,p.checked,!1));}return t}function U(t,n,e){try{"function"==typeof t?t(n):t.current=n;}catch(t){c.__e(t,e);}}function W(t,n,e){var r,o;if(c.unmount&&c.unmount(t),(r=t.ref)&&(r.current&&r.current!==t.__e||U(r,null,n)),null!=(r=t.__c)){if(r.componentWillUnmount)try{r.componentWillUnmount();}catch(t){c.__e(t,n);}r.base=r.__P=null,t.__c=void 0;}if(r=t.__k)for(o=0;o<r.length;o++)r[o]&&W(r[o],n,e||"function"!=typeof t.type);e||null==t.__e||b(t.__e),t.__=t.__e=t.__d=void 0;}function B(t,n,e){return this.constructor(t,e)}function q(t,n,e){var r,o,i;c.__&&c.__(t,n),o=(r="function"==typeof e)?null:e&&e.__k||n.__k,i=[],F(n,t=(!r&&e||n).__k=w(S,null,[t]),o||m,m,void 0!==n.ownerSVGElement,!r&&e?[e]:o?null:n.firstChild?l.call(n.childNodes):null,i,!r&&e?e:o?o.__e:n.firstChild,r),O(i,t);}function z(){return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(t){var n=16*Math.random()|0;return ("x"==t?n:3&n|8).toString(16)})}l=v.slice,c={__e:function(t,n,e,r){for(var o,i,u;n=n.__;)if((o=n.__c)&&!o.__)try{if((i=o.constructor)&&null!=i.getDerivedStateFromError&&(o.setState(i.getDerivedStateFromError(t)),u=o.__d),null!=o.componentDidCatch&&(o.componentDidCatch(t,r||{}),u=o.__d),u)return o.__E=o}catch(n){t=n;}throw t}},f=0,p=function(t){return null!=t&&void 0===t.constructor},N.prototype.setState=function(t,n){var e;e=null!=this.__s&&this.__s!==this.state?this.__s:this.__s=y({},this.state),"function"==typeof t&&(t=t(y({},e),this.props)),t&&y(e,t),null!=t&&this.__v&&(n&&this._sb.push(n),E(this));},N.prototype.forceUpdate=function(t){this.__v&&(this.__e=!0,t&&this.__h.push(t),E(this));},N.prototype.render=S,d=[],I.__r=0,_=0;var V=/*#__PURE__*/function(){function t(t){this._id=void 0,this._id=t||z();}return n(t,[{key:"id",get:function(){return this._id}}]),t}();function $(t){return w(t.parentElement||"span",{dangerouslySetInnerHTML:{__html:t.content}})}function G(t,n){return w($,{content:t,parentElement:n})}var K,X=/*#__PURE__*/function(t){function n(n){var e;return (e=t.call(this)||this).data=void 0,e.update(n),e}r(n,t);var e=n.prototype;return e.cast=function(t){return t instanceof HTMLElement?G(t.outerHTML):t},e.update=function(t){return this.data=this.cast(t),this},n}(V),Z=/*#__PURE__*/function(t){function e(n){var e;return (e=t.call(this)||this)._cells=void 0,e.cells=n||[],e}r(e,t);var o=e.prototype;return o.cell=function(t){return this._cells[t]},o.toArray=function(){return this.cells.map(function(t){return t.data})},e.fromCells=function(t){return new e(t.map(function(t){return new X(t.data)}))},n(e,[{key:"cells",get:function(){return this._cells},set:function(t){this._cells=t;}},{key:"length",get:function(){return this.cells.length}}]),e}(V),J=/*#__PURE__*/function(t){function e(n){var e;return (e=t.call(this)||this)._rows=void 0,e._length=void 0,e.rows=n instanceof Array?n:n instanceof Z?[n]:[],e}return r(e,t),e.prototype.toArray=function(){return this.rows.map(function(t){return t.toArray()})},e.fromRows=function(t){return new e(t.map(function(t){return Z.fromCells(t.cells)}))},e.fromArray=function(t){return new e((t=function(t){return !t[0]||t[0]instanceof Array?t:[t]}(t)).map(function(t){return new Z(t.map(function(t){return new X(t)}))}))},n(e,[{key:"rows",get:function(){return this._rows},set:function(t){this._rows=t;}},{key:"length",get:function(){return this._length||this.rows.length},set:function(t){this._length=t;}}]),e}(V),Q=/*#__PURE__*/function(){function t(){this.callbacks=void 0;}var n=t.prototype;return n.init=function(t){this.callbacks||(this.callbacks={}),t&&!this.callbacks[t]&&(this.callbacks[t]=[]);},n.listeners=function(){return this.callbacks},n.on=function(t,n){return this.init(t),this.callbacks[t].push(n),this},n.off=function(t,n){var e=t;return this.init(),this.callbacks[e]&&0!==this.callbacks[e].length?(this.callbacks[e]=this.callbacks[e].filter(function(t){return t!=n}),this):this},n.emit=function(t){var n=arguments,e=t;return this.init(e),this.callbacks[e].length>0&&(this.callbacks[e].forEach(function(t){return t.apply(void 0,[].slice.call(n,1))}),!0)},t}();!function(t){t[t.Initiator=0]="Initiator",t[t.ServerFilter=1]="ServerFilter",t[t.ServerSort=2]="ServerSort",t[t.ServerLimit=3]="ServerLimit",t[t.Extractor=4]="Extractor",t[t.Transformer=5]="Transformer",t[t.Filter=6]="Filter",t[t.Sort=7]="Sort",t[t.Limit=8]="Limit";}(K||(K={}));var Y=/*#__PURE__*/function(t){function e(n){var e;return (e=t.call(this)||this).id=void 0,e._props=void 0,e._props={},e.id=z(),n&&e.setProps(n),e}r(e,t);var o=e.prototype;return o.process=function(){var t=[].slice.call(arguments);this.validateProps instanceof Function&&this.validateProps.apply(this,t),this.emit.apply(this,["beforeProcess"].concat(t));var n=this._process.apply(this,t);return this.emit.apply(this,["afterProcess"].concat(t)),n},o.setProps=function(t){return Object.assign(this._props,t),this.emit("propsUpdated",this),this},n(e,[{key:"props",get:function(){return this._props}}]),e}(Q),tt=/*#__PURE__*/function(t){function e(){return t.apply(this,arguments)||this}return r(e,t),e.prototype._process=function(t){return this.props.keyword?(n=String(this.props.keyword).trim(),e=this.props.columns,r=this.props.ignoreHiddenColumns,o=t,i=this.props.selector,n=n.replace(/[-[\]{}()*+?.,\\^$|#\s]/g,"\\$&"),new J(o.rows.filter(function(t,o){return t.cells.some(function(t,u){if(!t)return !1;if(r&&e&&e[u]&&"object"==typeof e[u]&&e[u].hidden)return !1;var s="";if("function"==typeof i)s=i(t.data,o,u);else if("object"==typeof t.data){var a=t.data;a&&a.props&&a.props.content&&(s=a.props.content);}else s=String(t.data);return new RegExp(n,"gi").test(s)})}))):t;var n,e,r,o,i;},n(e,[{key:"type",get:function(){return K.Filter}}]),e}(Y);function nt(){var t="gridjs";return ""+t+[].slice.call(arguments).reduce(function(t,n){return t+"-"+n},"")}function et(){return [].slice.call(arguments).map(function(t){return t?t.toString():""}).filter(function(t){return t}).reduce(function(t,n){return (t||"")+" "+n},"").trim()}var rt,ot,it,ut,st=/*#__PURE__*/function(t){function o(){return t.apply(this,arguments)||this}return r(o,t),o.prototype._process=function(t){if(!this.props.keyword)return t;var n={};return this.props.url&&(n.url=this.props.url(t.url,this.props.keyword)),this.props.body&&(n.body=this.props.body(t.body,this.props.keyword)),e({},t,n)},n(o,[{key:"type",get:function(){return K.ServerFilter}}]),o}(Y),at=0,lt=[],ct=[],ft=c.__b,pt=c.__r,dt=c.diffed,ht=c.__c,_t=c.unmount;function mt(t,n){c.__h&&c.__h(ot,t,at||n),at=0;var e=ot.__H||(ot.__H={__:[],__h:[]});return t>=e.__.length&&e.__.push({__V:ct}),e.__[t]}function vt(t){return at=1,function(t,n,e){var r=mt(rt++,2);if(r.t=t,!r.__c&&(r.__=[Pt(void 0,n),function(t){var n=r.__N?r.__N[0]:r.__[0],e=r.t(n,t);n!==e&&(r.__N=[e,r.__[1]],r.__c.setState({}));}],r.__c=ot,!ot.u)){ot.u=!0;var o=ot.shouldComponentUpdate;ot.shouldComponentUpdate=function(t,n,e){if(!r.__c.__H)return !0;var i=r.__c.__H.__.filter(function(t){return t.__c});if(i.every(function(t){return !t.__N}))return !o||o.call(this,t,n,e);var u=!1;return i.forEach(function(t){if(t.__N){var n=t.__[0];t.__=t.__N,t.__N=void 0,n!==t.__[0]&&(u=!0);}}),!(!u&&r.__c.props===t)&&(!o||o.call(this,t,n,e))};}return r.__N||r.__}(Pt,t)}function gt(t,n){var e=mt(rt++,3);!c.__s&&Ct(e.__H,n)&&(e.__=t,e.i=n,ot.__H.__h.push(e));}function yt(t){return at=5,bt(function(){return {current:t}},[])}function bt(t,n){var e=mt(rt++,7);return Ct(e.__H,n)?(e.__V=t(),e.i=n,e.__h=t,e.__V):e.__}function wt(){for(var t;t=lt.shift();)if(t.__P&&t.__H)try{t.__H.__h.forEach(St),t.__H.__h.forEach(Nt),t.__H.__h=[];}catch(n){t.__H.__h=[],c.__e(n,t.__v);}}c.__b=function(t){ot=null,ft&&ft(t);},c.__r=function(t){pt&&pt(t),rt=0;var n=(ot=t.__c).__H;n&&(it===ot?(n.__h=[],ot.__h=[],n.__.forEach(function(t){t.__N&&(t.__=t.__N),t.__V=ct,t.__N=t.i=void 0;})):(n.__h.forEach(St),n.__h.forEach(Nt),n.__h=[])),it=ot;},c.diffed=function(t){dt&&dt(t);var n=t.__c;n&&n.__H&&(n.__H.__h.length&&(1!==lt.push(n)&&ut===c.requestAnimationFrame||((ut=c.requestAnimationFrame)||kt)(wt)),n.__H.__.forEach(function(t){t.i&&(t.__H=t.i),t.__V!==ct&&(t.__=t.__V),t.i=void 0,t.__V=ct;})),it=ot=null;},c.__c=function(t,n){n.some(function(t){try{t.__h.forEach(St),t.__h=t.__h.filter(function(t){return !t.__||Nt(t)});}catch(e){n.some(function(t){t.__h&&(t.__h=[]);}),n=[],c.__e(e,t.__v);}}),ht&&ht(t,n);},c.unmount=function(t){_t&&_t(t);var n,e=t.__c;e&&e.__H&&(e.__H.__.forEach(function(t){try{St(t);}catch(t){n=t;}}),e.__H=void 0,n&&c.__e(n,e.__v));};var xt="function"==typeof requestAnimationFrame;function kt(t){var n,e=function(){clearTimeout(r),xt&&cancelAnimationFrame(n),setTimeout(t);},r=setTimeout(e,100);xt&&(n=requestAnimationFrame(e));}function St(t){var n=ot,e=t.__c;"function"==typeof e&&(t.__c=void 0,e()),ot=n;}function Nt(t){var n=ot;t.__c=t.__(),ot=n;}function Ct(t,n){return !t||t.length!==n.length||n.some(function(n,e){return n!==t[e]})}function Pt(t,n){return "function"==typeof n?n(t):n}function Et(){return function(t){var n=ot.context[t.__c],e=mt(rt++,9);return e.c=t,n?(null==e.__&&(e.__=!0,n.sub(ot)),n.props.value):t.__}(cn)}var It={search:{placeholder:"Type a keyword..."},sort:{sortAsc:"Sort column ascending",sortDesc:"Sort column descending"},pagination:{previous:"Previous",next:"Next",navigate:function(t,n){return "Page "+t+" of "+n},page:function(t){return "Page "+t},showing:"Showing",of:"of",to:"to",results:"results"},loading:"Loading...",noRecordsFound:"No matching records found",error:"An error happened while fetching the data"},Tt=/*#__PURE__*/function(){function t(t){this._language=void 0,this._defaultLanguage=void 0,this._language=t,this._defaultLanguage=It;}var n=t.prototype;return n.getString=function(t,n){if(!n||!t)return null;var e=t.split("."),r=e[0];if(n[r]){var o=n[r];return "string"==typeof o?function(){return o}:"function"==typeof o?o:this.getString(e.slice(1).join("."),o)}return null},n.translate=function(t){var n,e=this.getString(t,this._language);return (n=e||this.getString(t,this._defaultLanguage))?n.apply(void 0,[].slice.call(arguments,1)):t},t}();function Lt(){var t=Et();return function(n){var e;return (e=t.translator).translate.apply(e,[n].concat([].slice.call(arguments,1)))}}var At=function(t){return function(n){return e({},n,{search:{keyword:t}})}};function Ht(){return Et().store}function jt(t){var n=Ht(),e=vt(t(n.getState())),r=e[0],o=e[1];return gt(function(){return n.subscribe(function(){var e=t(n.getState());r!==e&&o(e);})},[]),r}function Dt(){var t,n=vt(void 0),e=n[0],r=n[1],o=Et(),i=o.search,u=Lt(),s=Ht().dispatch,a=jt(function(t){return t.search});gt(function(){e&&e.setProps({keyword:null==a?void 0:a.keyword});},[a,e]),gt(function(){r(i.server?new st({keyword:i.keyword,url:i.server.url,body:i.server.body}):new tt({keyword:i.keyword,columns:o.header&&o.header.columns,ignoreHiddenColumns:i.ignoreHiddenColumns||void 0===i.ignoreHiddenColumns,selector:i.selector})),i.keyword&&s(At(i.keyword));},[i]),gt(function(){return o.pipeline.register(e),function(){return o.pipeline.unregister(e)}},[o,e]);var l,c,f,p=function(t,n){return at=8,bt(function(){return t},n)}((l=function(t){t.target instanceof HTMLInputElement&&s(At(t.target.value));},c=e instanceof st?i.debounceTimeout||250:0,function(){var t=arguments;return new Promise(function(n){f&&clearTimeout(f),f=setTimeout(function(){return n(l.apply(void 0,[].slice.call(t)))},c);})}),[i,e]);return w("div",{className:nt(et("search",null==(t=o.className)?void 0:t.search))},w("input",{type:"search",placeholder:u("search.placeholder"),"aria-label":u("search.placeholder"),onInput:p,className:et(nt("input"),nt("search","input")),value:(null==a?void 0:a.keyword)||""}))}var Mt=/*#__PURE__*/function(t){function e(){return t.apply(this,arguments)||this}r(e,t);var o=e.prototype;return o.validateProps=function(){if(isNaN(Number(this.props.limit))||isNaN(Number(this.props.page)))throw Error("Invalid parameters passed")},o._process=function(t){var n=this.props.page;return new J(t.rows.slice(n*this.props.limit,(n+1)*this.props.limit))},n(e,[{key:"type",get:function(){return K.Limit}}]),e}(Y),Ft=/*#__PURE__*/function(t){function o(){return t.apply(this,arguments)||this}return r(o,t),o.prototype._process=function(t){var n={};return this.props.url&&(n.url=this.props.url(t.url,this.props.page,this.props.limit)),this.props.body&&(n.body=this.props.body(t.body,this.props.page,this.props.limit)),e({},t,n)},n(o,[{key:"type",get:function(){return K.ServerLimit}}]),o}(Y);function Ot(){var t=Et(),n=t.pagination,e=n.server,r=n.summary,o=void 0===r||r,i=n.nextButton,u=void 0===i||i,s=n.prevButton,a=void 0===s||s,l=n.buttonsCount,c=void 0===l?3:l,f=n.limit,p=void 0===f?10:f,d=n.page,h=void 0===d?0:d,_=n.resetPageOnUpdate,m=void 0===_||_,v=yt(null),g=vt(h),y=g[0],b=g[1],x=vt(0),k=x[0],N=x[1],C=Lt();gt(function(){return v.current=e?new Ft({limit:p,page:y,url:e.url,body:e.body}):new Mt({limit:p,page:y}),v.current instanceof Ft?t.pipeline.on("afterProcess",function(t){return N(t.length)}):v.current instanceof Mt&&v.current.on("beforeProcess",function(t){return N(t.length)}),t.pipeline.on("updated",P),t.pipeline.register(v.current),t.pipeline.on("error",function(){N(0),b(0);}),function(){t.pipeline.unregister(v.current),t.pipeline.off("updated",P);}},[]);var P=function(t){m&&t!==v.current&&b(0);},E=function(){return Math.ceil(k/p)},I=function(t){if(t>=E()||t<0||t===y)return null;b(t),v.current.setProps({page:t});};return w("div",{className:et(nt("pagination"),t.className.pagination)},w(S,null,o&&k>0&&w("div",{role:"status","aria-live":"polite",className:et(nt("summary"),t.className.paginationSummary),title:C("pagination.navigate",y+1,E())},C("pagination.showing")," ",w("b",null,C(""+(y*p+1)))," ",C("pagination.to")," ",w("b",null,C(""+Math.min((y+1)*p,k)))," ",C("pagination.of")," ",w("b",null,C(""+k))," ",C("pagination.results"))),w("div",{className:nt("pages")},a&&w("button",{tabIndex:0,role:"button",disabled:0===y,onClick:function(){return I(y-1)},title:C("pagination.previous"),"aria-label":C("pagination.previous"),className:et(t.className.paginationButton,t.className.paginationButtonPrev)},C("pagination.previous")),function(){if(c<=0)return null;var n=Math.min(E(),c),e=Math.min(y,Math.floor(n/2));return y+Math.floor(n/2)>=E()&&(e=n-(E()-y)),w(S,null,E()>n&&y-e>0&&w(S,null,w("button",{tabIndex:0,role:"button",onClick:function(){return I(0)},title:C("pagination.firstPage"),"aria-label":C("pagination.firstPage"),className:t.className.paginationButton},C("1")),w("button",{tabIndex:-1,className:et(nt("spread"),t.className.paginationButton)},"...")),Array.from(Array(n).keys()).map(function(t){return y+(t-e)}).map(function(n){return w("button",{tabIndex:0,role:"button",onClick:function(){return I(n)},className:et(y===n?et(nt("currentPage"),t.className.paginationButtonCurrent):null,t.className.paginationButton),title:C("pagination.page",n+1),"aria-label":C("pagination.page",n+1)},C(""+(n+1)))}),E()>n&&E()>y+e+1&&w(S,null,w("button",{tabIndex:-1,className:et(nt("spread"),t.className.paginationButton)},"..."),w("button",{tabIndex:0,role:"button",onClick:function(){return I(E()-1)},title:C("pagination.page",E()),"aria-label":C("pagination.page",E()),className:t.className.paginationButton},C(""+E()))))}(),u&&w("button",{tabIndex:0,role:"button",disabled:E()===y+1||0===E(),onClick:function(){return I(y+1)},title:C("pagination.next"),"aria-label":C("pagination.next"),className:et(t.className.paginationButton,t.className.paginationButtonNext)},C("pagination.next"))))}function Rt(t,n){return "string"==typeof t?t.indexOf("%")>-1?n/100*parseInt(t,10):parseInt(t,10):t}function Ut(t){return t?Math.floor(t)+"px":""}function Wt(t){var n=t.tableRef.cloneNode(!0);return n.style.position="absolute",n.style.width="100%",n.style.zIndex="-2147483640",n.style.visibility="hidden",w("div",{ref:function(t){t&&t.appendChild(n);}})}function Bt(t){if(!t)return "";var n=t.split(" ");return 1===n.length&&/([a-z][A-Z])+/g.test(t)?t:n.map(function(t,n){return 0==n?t.toLowerCase():t.charAt(0).toUpperCase()+t.slice(1).toLowerCase()}).join("")}var qt,zt=new(/*#__PURE__*/function(){function t(){}var n=t.prototype;return n.format=function(t,n){return "[Grid.js] ["+n.toUpperCase()+"]: "+t},n.error=function(t,n){void 0===n&&(n=!1);var e=this.format(t,"error");if(n)throw Error(e);console.error(e);},n.warn=function(t){console.warn(this.format(t,"warn"));},n.info=function(t){console.info(this.format(t,"info"));},t}());!function(t){t[t.Header=0]="Header",t[t.Footer=1]="Footer",t[t.Cell=2]="Cell";}(qt||(qt={}));var Vt=/*#__PURE__*/function(){function t(){this.plugins=void 0,this.plugins=[];}var n=t.prototype;return n.get=function(t){return this.plugins.find(function(n){return n.id===t})},n.add=function(t){return t.id?this.get(t.id)?(zt.error("Duplicate plugin ID: "+t.id),this):(this.plugins.push(t),this):(zt.error("Plugin ID cannot be empty"),this)},n.remove=function(t){var n=this.get(t);return n&&this.plugins.splice(this.plugins.indexOf(n),1),this},n.list=function(t){var n;return n=null!=t||null!=t?this.plugins.filter(function(n){return n.position===t}):this.plugins,n.sort(function(t,n){return t.order&&n.order?t.order-n.order:1})},t}();function $t(t){var n=this,r=Et();if(t.pluginId){var o=r.plugin.get(t.pluginId);return o?w(S,{},w(o.component,e({plugin:o},t.props))):null}return void 0!==t.position?w(S,{},r.plugin.list(t.position).map(function(t){return w(t.component,e({plugin:t},n.props.props))})):null}var Gt=/*#__PURE__*/function(t){function o(){var n;return (n=t.call(this)||this)._columns=void 0,n._columns=[],n}r(o,t);var i=o.prototype;return i.adjustWidth=function(t,n,r){var i=t.container,u=t.autoWidth;if(!i)return this;var a=i.clientWidth,l={};n.current&&u&&(q(w(Wt,{tableRef:n.current}),r.current),l=function(t){var n=t.querySelector("table");if(!n)return {};var r=n.className,o=n.style.cssText;n.className=r+" "+nt("shadowTable"),n.style.tableLayout="auto",n.style.width="auto",n.style.padding="0",n.style.margin="0",n.style.border="none",n.style.outline="none";var i=Array.from(n.parentNode.querySelectorAll("thead th")).reduce(function(t,n){var r;return n.style.width=n.clientWidth+"px",e(((r={})[n.getAttribute("data-column-id")]={minWidth:n.clientWidth},r),t)},{});return n.className=r,n.style.cssText=o,n.style.tableLayout="auto",Array.from(n.parentNode.querySelectorAll("thead th")).reduce(function(t,n){return t[n.getAttribute("data-column-id")].width=n.clientWidth,t},i)}(r.current));for(var c,f=s(o.tabularFormat(this.columns).reduce(function(t,n){return t.concat(n)},[]));!(c=f()).done;){var p=c.value;p.columns&&p.columns.length>0||(!p.width&&u?p.id in l&&(p.width=Ut(l[p.id].width),p.minWidth=Ut(l[p.id].minWidth)):p.width=Ut(Rt(p.width,a)));}return n.current&&u&&q(null,r.current),this},i.setSort=function(t,n){for(var r,o=s(n||this.columns||[]);!(r=o()).done;){var i=r.value;i.columns&&i.columns.length>0?i.sort=void 0:void 0===i.sort&&t?i.sort={}:i.sort?"object"==typeof i.sort&&(i.sort=e({},i.sort)):i.sort=void 0,i.columns&&this.setSort(t,i.columns);}},i.setResizable=function(t,n){for(var e,r=s(n||this.columns||[]);!(e=r()).done;){var o=e.value;void 0===o.resizable&&(o.resizable=t),o.columns&&this.setResizable(t,o.columns);}},i.setID=function(t){for(var n,e=s(t||this.columns||[]);!(n=e()).done;){var r=n.value;r.id||"string"!=typeof r.name||(r.id=Bt(r.name)),r.id||zt.error('Could not find a valid ID for one of the columns. Make sure a valid "id" is set for all columns.'),r.columns&&this.setID(r.columns);}},i.populatePlugins=function(t,n){for(var r,o=s(n);!(r=o()).done;){var i=r.value;void 0!==i.plugin&&t.add(e({id:i.id},i.plugin,{position:qt.Cell}));}},o.fromColumns=function(t){for(var n,e=new o,r=s(t);!(n=r()).done;){var i=n.value;if("string"==typeof i||p(i))e.columns.push({name:i});else if("object"==typeof i){var u=i;u.columns&&(u.columns=o.fromColumns(u.columns).columns),"object"==typeof u.plugin&&void 0===u.data&&(u.data=null),e.columns.push(i);}}return e},o.createFromConfig=function(t){var n=new o;return t.from?n.columns=o.fromHTMLTable(t.from).columns:t.columns?n.columns=o.fromColumns(t.columns).columns:!t.data||"object"!=typeof t.data[0]||t.data[0]instanceof Array||(n.columns=Object.keys(t.data[0]).map(function(t){return {name:t}})),n.columns.length?(n.setID(),n.setSort(t.sort),n.setResizable(t.resizable),n.populatePlugins(t.plugin,n.columns),n):null},o.fromHTMLTable=function(t){for(var n,e=new o,r=s(t.querySelector("thead").querySelectorAll("th"));!(n=r()).done;){var i=n.value;e.columns.push({name:i.innerHTML,width:i.width});}return e},o.tabularFormat=function(t){var n=[],e=t||[],r=[];if(e&&e.length){n.push(e);for(var o,i=s(e);!(o=i()).done;){var u=o.value;u.columns&&u.columns.length&&(r=r.concat(u.columns));}r.length&&(n=n.concat(this.tabularFormat(r)));}return n},o.leafColumns=function(t){var n=[],e=t||[];if(e&&e.length)for(var r,o=s(e);!(r=o()).done;){var i=r.value;i.columns&&0!==i.columns.length||n.push(i),i.columns&&(n=n.concat(this.leafColumns(i.columns)));}return n},o.maximumDepth=function(t){return this.tabularFormat([t]).length-1},n(o,[{key:"columns",get:function(){return this._columns},set:function(t){this._columns=t;}},{key:"visibleColumns",get:function(){return this._columns.filter(function(t){return !t.hidden})}}]),o}(V),Kt=function(){},Xt=/*#__PURE__*/function(t){function n(n){var e;return (e=t.call(this)||this).data=void 0,e.set(n),e}r(n,t);var e=n.prototype;return e.get=function(){try{return Promise.resolve(this.data()).then(function(t){return {data:t,total:t.length}})}catch(t){return Promise.reject(t)}},e.set=function(t){return t instanceof Array?this.data=function(){return t}:t instanceof Function&&(this.data=t),this},n}(Kt),Zt=/*#__PURE__*/function(t){function n(n){var e;return (e=t.call(this)||this).options=void 0,e.options=n,e}r(n,t);var o=n.prototype;return o.handler=function(t){return "function"==typeof this.options.handle?this.options.handle(t):t.ok?t.json():(zt.error("Could not fetch data: "+t.status+" - "+t.statusText,!0),null)},o.get=function(t){var n=e({},this.options,t);return "function"==typeof n.data?n.data(n):fetch(n.url,n).then(this.handler.bind(this)).then(function(t){return {data:n.then(t),total:"function"==typeof n.total?n.total(t):void 0}})},n}(Kt),Jt=/*#__PURE__*/function(){function t(){}return t.createFromConfig=function(t){var n=null;return t.data&&(n=new Xt(t.data)),t.from&&(n=new Xt(this.tableElementToArray(t.from)),t.from.style.display="none"),t.server&&(n=new Zt(t.server)),n||zt.error("Could not determine the storage type",!0),n},t.tableElementToArray=function(t){for(var n,e,r=[],o=s(t.querySelector("tbody").querySelectorAll("tr"));!(n=o()).done;){for(var i,u=[],a=s(n.value.querySelectorAll("td"));!(i=a()).done;){var l=i.value;1===l.childNodes.length&&l.childNodes[0].nodeType===Node.TEXT_NODE?u.push((e=l.innerHTML,(new DOMParser).parseFromString(e,"text/html").documentElement.textContent)):u.push(G(l.innerHTML));}r.push(u);}return r},t}(),Qt="undefined"!=typeof Symbol?Symbol.iterator||(Symbol.iterator=Symbol("Symbol.iterator")):"@@iterator";function Yt(t,n,e){if(!t.s){if(e instanceof tn){if(!e.s)return void(e.o=Yt.bind(null,t,n));1&n&&(n=e.s),e=e.v;}if(e&&e.then)return void e.then(Yt.bind(null,t,n),Yt.bind(null,t,2));t.s=n,t.v=e;var r=t.o;r&&r(t);}}var tn=/*#__PURE__*/function(){function t(){}return t.prototype.then=function(n,e){var r=new t,o=this.s;if(o){var i=1&o?n:e;if(i){try{Yt(r,1,i(this.v));}catch(t){Yt(r,2,t);}return r}return this}return this.o=function(t){try{var o=t.v;1&t.s?Yt(r,1,n?n(o):o):e?Yt(r,1,e(o)):Yt(r,2,o);}catch(t){Yt(r,2,t);}},r},t}();function nn(t){return t instanceof tn&&1&t.s}var en=/*#__PURE__*/function(t){function e(n){var e;return (e=t.call(this)||this)._steps=new Map,e.cache=new Map,e.lastProcessorIndexUpdated=-1,n&&n.forEach(function(t){return e.register(t)}),e}r(e,t);var o=e.prototype;return o.clearCache=function(){this.cache=new Map,this.lastProcessorIndexUpdated=-1;},o.register=function(t,n){if(void 0===n&&(n=null),t){if(null===t.type)throw Error("Processor type is not defined");t.on("propsUpdated",this.processorPropsUpdated.bind(this)),this.addProcessorByPriority(t,n),this.afterRegistered(t);}},o.unregister=function(t){if(t){var n=this._steps.get(t.type);n&&n.length&&(this._steps.set(t.type,n.filter(function(n){return n!=t})),this.emit("updated",t));}},o.addProcessorByPriority=function(t,n){var e=this._steps.get(t.type);if(!e){var r=[];this._steps.set(t.type,r),e=r;}if(null===n||n<0)e.push(t);else if(e[n]){var o=e.slice(0,n-1),i=e.slice(n+1);this._steps.set(t.type,o.concat(t).concat(i));}else e[n]=t;},o.getStepsByType=function(t){return this.steps.filter(function(n){return n.type===t})},o.getSortedProcessorTypes=function(){return Object.keys(K).filter(function(t){return !isNaN(Number(t))}).map(function(t){return Number(t)})},o.process=function(t){try{var n=function(t){return e.lastProcessorIndexUpdated=o.length,e.emit("afterProcess",i),i},e=this,r=e.lastProcessorIndexUpdated,o=e.steps,i=t,u=function(t,n){try{var u=function(t,n,e){if("function"==typeof t[Qt]){var r,o,i,u=t[Qt]();if(function t(e){try{for(;!(r=u.next()).done;)if((e=n(r.value))&&e.then){if(!nn(e))return void e.then(t,i||(i=Yt.bind(null,o=new tn,2)));e=e.v;}o?Yt(o,1,e):o=e;}catch(t){Yt(o||(o=new tn),2,t);}}(),u.return){var s=function(t){try{r.done||u.return();}catch(t){}return t};if(o&&o.then)return o.then(s,function(t){throw s(t)});s();}return o}if(!("length"in t))throw new TypeError("Object is not iterable");for(var a=[],l=0;l<t.length;l++)a.push(t[l]);return function(t,n,e){var r,o,i=-1;return function e(u){try{for(;++i<t.length;)if((u=n(i))&&u.then){if(!nn(u))return void u.then(e,o||(o=Yt.bind(null,r=new tn,2)));u=u.v;}r?Yt(r,1,u):r=u;}catch(t){Yt(r||(r=new tn),2,t);}}(),r}(a,function(t){return n(a[t])})}(o,function(t){var n=e.findProcessorIndexByID(t.id),o=function(){if(n>=r)return Promise.resolve(t.process(i)).then(function(n){e.cache.set(t.id,i=n);});i=e.cache.get(t.id);}();if(o&&o.then)return o.then(function(){})});}catch(t){return n(t)}return u&&u.then?u.then(void 0,n):u}(0,function(t){throw zt.error(t),e.emit("error",i),t});return Promise.resolve(u&&u.then?u.then(n):n())}catch(t){return Promise.reject(t)}},o.findProcessorIndexByID=function(t){return this.steps.findIndex(function(n){return n.id==t})},o.setLastProcessorIndex=function(t){var n=this.findProcessorIndexByID(t.id);this.lastProcessorIndexUpdated>n&&(this.lastProcessorIndexUpdated=n);},o.processorPropsUpdated=function(t){this.setLastProcessorIndex(t),this.emit("propsUpdated"),this.emit("updated",t);},o.afterRegistered=function(t){this.setLastProcessorIndex(t),this.emit("afterRegister"),this.emit("updated",t);},n(e,[{key:"steps",get:function(){for(var t,n=[],e=s(this.getSortedProcessorTypes());!(t=e()).done;){var r=this._steps.get(t.value);r&&r.length&&(n=n.concat(r));}return n.filter(function(t){return t})}}]),e}(Q),rn=/*#__PURE__*/function(t){function e(){return t.apply(this,arguments)||this}return r(e,t),e.prototype._process=function(t){try{return Promise.resolve(this.props.storage.get(t))}catch(t){return Promise.reject(t)}},n(e,[{key:"type",get:function(){return K.Extractor}}]),e}(Y),on=/*#__PURE__*/function(t){function e(){return t.apply(this,arguments)||this}return r(e,t),e.prototype._process=function(t){var n=J.fromArray(t.data);return n.length=t.total,n},n(e,[{key:"type",get:function(){return K.Transformer}}]),e}(Y),un=/*#__PURE__*/function(t){function o(){return t.apply(this,arguments)||this}return r(o,t),o.prototype._process=function(){return Object.entries(this.props.serverStorageOptions).filter(function(t){return "function"!=typeof t[1]}).reduce(function(t,n){var r;return e({},t,((r={})[n[0]]=n[1],r))},{})},n(o,[{key:"type",get:function(){return K.Initiator}}]),o}(Y),sn=/*#__PURE__*/function(t){function e(){return t.apply(this,arguments)||this}r(e,t);var o=e.prototype;return o.castData=function(t){if(!t||!t.length)return [];if(!this.props.header||!this.props.header.columns)return t;var n=Gt.leafColumns(this.props.header.columns);return t[0]instanceof Array?t.map(function(t){var e=0;return n.map(function(n,r){return void 0!==n.data?(e++,"function"==typeof n.data?n.data(t):n.data):t[r-e]})}):"object"!=typeof t[0]||t[0]instanceof Array?[]:t.map(function(t){return n.map(function(n,e){return void 0!==n.data?"function"==typeof n.data?n.data(t):n.data:n.id?t[n.id]:(zt.error("Could not find the correct cell for column at position "+e+".\n                          Make sure either 'id' or 'selector' is defined for all columns."),null)})})},o._process=function(t){return {data:this.castData(t.data),total:t.total}},n(e,[{key:"type",get:function(){return K.Transformer}}]),e}(Y),an=/*#__PURE__*/function(){function t(){}return t.createFromConfig=function(t){var n=new en;return t.storage instanceof Zt&&n.register(new un({serverStorageOptions:t.server})),n.register(new rn({storage:t.storage})),n.register(new sn({header:t.header})),n.register(new on),n},t}(),ln=function(t){var n=this;this.state=void 0,this.listeners=[],this.isDispatching=!1,this.getState=function(){return n.state},this.getListeners=function(){return n.listeners},this.dispatch=function(t){if("function"!=typeof t)throw new Error("Reducer is not a function");if(n.isDispatching)throw new Error("Reducers may not dispatch actions");n.isDispatching=!0;var e=n.state;try{n.state=t(n.state);}finally{n.isDispatching=!1;}for(var r,o=s(n.listeners);!(r=o()).done;)(0, r.value)(n.state,e);return n.state},this.subscribe=function(t){if("function"!=typeof t)throw new Error("Listener is not a function");return n.listeners=[].concat(n.listeners,[t]),function(){return n.listeners=n.listeners.filter(function(n){return n!==t})}},this.state=t;},cn=function(t,n){var e={__c:n="__cC"+_++,__:null,Consumer:function(t,n){return t.children(n)},Provider:function(t){var e,r;return this.getChildContext||(e=[],(r={})[n]=this,this.getChildContext=function(){return r},this.shouldComponentUpdate=function(t){this.props.value!==t.value&&e.some(E);},this.sub=function(t){e.push(t);var n=t.componentWillUnmount;t.componentWillUnmount=function(){e.splice(e.indexOf(t),1),n&&n.call(t);};}),t.children}};return e.Provider.__=e.Consumer.contextType=e}(),fn=/*#__PURE__*/function(){function t(){Object.assign(this,t.defaultConfig());}var n=t.prototype;return n.assign=function(t){return Object.assign(this,t)},n.update=function(n){return n?(this.assign(t.fromPartialConfig(e({},this,n))),this):this},t.defaultConfig=function(){return {store:new ln({status:a.Init,header:void 0,data:null}),plugin:new Vt,tableRef:{current:null},width:"100%",height:"auto",autoWidth:!0,style:{},className:{}}},t.fromPartialConfig=function(n){var e=(new t).assign(n);return "boolean"==typeof n.sort&&n.sort&&e.assign({sort:{multiColumn:!0}}),e.assign({header:Gt.createFromConfig(e)}),e.assign({storage:Jt.createFromConfig(e)}),e.assign({pipeline:an.createFromConfig(e)}),e.assign({translator:new Tt(e.language)}),e.search&&e.plugin.add({id:"search",position:qt.Header,component:Dt}),e.pagination&&e.plugin.add({id:"pagination",position:qt.Footer,component:Ot}),e.plugins&&e.plugins.forEach(function(t){return e.plugin.add(t)}),e},t}();function pn(t){var n,r=Et();return w("td",e({role:t.role,colSpan:t.colSpan,"data-column-id":t.column&&t.column.id,className:et(nt("td"),t.className,r.className.td),style:e({},t.style,r.style.td),onClick:function(n){t.messageCell||r.eventEmitter.emit("cellClick",n,t.cell,t.column,t.row);}},(n=t.column)?"function"==typeof n.attributes?n.attributes(t.cell.data,t.row,t.column):n.attributes:{}),t.column&&"function"==typeof t.column.formatter?t.column.formatter(t.cell.data,t.row,t.column):t.column&&t.column.plugin?w($t,{pluginId:t.column.id,props:{column:t.column,cell:t.cell,row:t.row}}):t.cell.data)}function dn(t){var n=Et(),e=jt(function(t){return t.header});return w("tr",{className:et(nt("tr"),n.className.tr),onClick:function(e){t.messageRow||n.eventEmitter.emit("rowClick",e,t.row);}},t.children?t.children:t.row.cells.map(function(n,r){var o=function(t){if(e){var n=Gt.leafColumns(e.columns);if(n)return n[t]}return null}(r);return o&&o.hidden?null:w(pn,{key:n.id,cell:n,row:t.row,column:o})}))}function hn(t){return w(dn,{messageRow:!0},w(pn,{role:"alert",colSpan:t.colSpan,messageCell:!0,cell:new X(t.message),className:et(nt("message"),t.className?t.className:null)}))}function _n(){var t=Et(),n=jt(function(t){return t.data}),e=jt(function(t){return t.status}),r=jt(function(t){return t.header}),o=Lt(),i=function(){return r?r.visibleColumns.length:0};return w("tbody",{className:et(nt("tbody"),t.className.tbody)},n&&n.rows.map(function(t){return w(dn,{key:t.id,row:t})}),e===a.Loading&&(!n||0===n.length)&&w(hn,{message:o("loading"),colSpan:i(),className:et(nt("loading"),t.className.loading)}),e===a.Rendered&&n&&0===n.length&&w(hn,{message:o("noRecordsFound"),colSpan:i(),className:et(nt("notfound"),t.className.notfound)}),e===a.Error&&w(hn,{message:o("error"),colSpan:i(),className:et(nt("error"),t.className.error)}))}var mn=/*#__PURE__*/function(t){function e(){return t.apply(this,arguments)||this}r(e,t);var o=e.prototype;return o.validateProps=function(){for(var t,n=s(this.props.columns);!(t=n()).done;){var e=t.value;void 0===e.direction&&(e.direction=1),1!==e.direction&&-1!==e.direction&&zt.error("Invalid sort direction "+e.direction);}},o.compare=function(t,n){return t>n?1:t<n?-1:0},o.compareWrapper=function(t,n){for(var e,r=0,o=s(this.props.columns);!(e=o()).done;){var i=e.value;if(0!==r)break;var u=t.cells[i.index].data,a=n.cells[i.index].data;r|="function"==typeof i.compare?i.compare(u,a)*i.direction:this.compare(u,a)*i.direction;}return r},o._process=function(t){var n=[].concat(t.rows);n.sort(this.compareWrapper.bind(this));var e=new J(n);return e.length=t.length,e},n(e,[{key:"type",get:function(){return K.Sort}}]),e}(Y),vn=function(t,n,r,o){return function(i){var u=i.sort?[].concat(i.sort.columns):[],s=u.length,a=u.find(function(n){return n.index===t}),l=!1,c=!1,f=!1,p=!1;if(void 0!==a?r?-1===a.direction?f=!0:p=!0:1===s?p=!0:s>1&&(c=!0,l=!0):0===s?l=!0:s>0&&!r?(l=!0,c=!0):s>0&&r&&(l=!0),c&&(u=[]),l)u.push({index:t,direction:n,compare:o});else if(p){var d=u.indexOf(a);u[d].direction=n;}else if(f){var h=u.indexOf(a);u.splice(h,1);}return e({},i,{sort:{columns:u}})}},gn=function(t,n,r){return function(o){var i=(o.sort?[].concat(o.sort.columns):[]).find(function(n){return n.index===t});return e({},o,i?vn(t,1===i.direction?-1:1,n,r)(o):vn(t,1,n,r)(o))}},yn=/*#__PURE__*/function(t){function o(){return t.apply(this,arguments)||this}return r(o,t),o.prototype._process=function(t){var n={};return this.props.url&&(n.url=this.props.url(t.url,this.props.columns)),this.props.body&&(n.body=this.props.body(t.body,this.props.columns)),e({},t,n)},n(o,[{key:"type",get:function(){return K.ServerSort}}]),o}(Y);function bn(t){var n=Et(),r=Lt(),o=vt(0),i=o[0],u=o[1],s=vt(void 0),a=s[0],l=s[1],c=jt(function(t){return t.sort}),f=Ht().dispatch,p=n.sort;gt(function(){var t=d();t&&l(t);},[]),gt(function(){return n.pipeline.register(a),function(){return n.pipeline.unregister(a)}},[n,a]),gt(function(){if(c){var n=c.columns.find(function(n){return n.index===t.index});u(n?n.direction:0);}},[c]),gt(function(){a&&c&&a.setProps({columns:c.columns});},[c]);var d=function(){var t=K.Sort;return p&&"object"==typeof p.server&&(t=K.ServerSort),0===n.pipeline.getStepsByType(t).length?t===K.ServerSort?new yn(e({columns:c?c.columns:[]},p.server)):new mn({columns:c?c.columns:[]}):null};return w("button",{tabIndex:-1,"aria-label":r("sort.sort"+(1===i?"Desc":"Asc")),title:r("sort.sort"+(1===i?"Desc":"Asc")),className:et(nt("sort"),nt("sort",function(t){return 1===t?"asc":-1===t?"desc":"neutral"}(i)),n.className.sort),onClick:function(n){n.preventDefault(),n.stopPropagation(),f(gn(t.index,!0===n.shiftKey&&p.multiColumn,t.compare));}})}function wn(t){var n,e=function(t){return t instanceof MouseEvent?Math.floor(t.pageX):Math.floor(t.changedTouches[0].pageX)},r=function(r){r.stopPropagation();var u,s,a,l,c,f=parseInt(t.thRef.current.style.width,10)-e(r);u=function(t){return o(t,f)},void 0===(s=10)&&(s=100),n=function(){var t=[].slice.call(arguments);a?(clearTimeout(l),l=setTimeout(function(){Date.now()-c>=s&&(u.apply(void 0,t),c=Date.now());},Math.max(s-(Date.now()-c),0))):(u.apply(void 0,t),c=Date.now(),a=!0);},document.addEventListener("mouseup",i),document.addEventListener("touchend",i),document.addEventListener("mousemove",n),document.addEventListener("touchmove",n);},o=function(n,r){n.stopPropagation();var o=t.thRef.current;r+e(n)>=parseInt(o.style.minWidth,10)&&(o.style.width=r+e(n)+"px");},i=function t(e){e.stopPropagation(),document.removeEventListener("mouseup",t),document.removeEventListener("mousemove",n),document.removeEventListener("touchmove",n),document.removeEventListener("touchend",t);};return w("div",{className:et(nt("th"),nt("resizable")),onMouseDown:r,onTouchStart:r,onClick:function(t){return t.stopPropagation()}})}function xn(t){var n=Et(),r=yt(null),o=vt({}),i=o[0],u=o[1],s=Ht().dispatch;gt(function(){if(n.fixedHeader&&r.current){var t=r.current.offsetTop;"number"==typeof t&&u({top:t});}},[r]);var a,l=function(){return null!=t.column.sort},c=function(e){e.stopPropagation(),l()&&s(gn(t.index,!0===e.shiftKey&&n.sort.multiColumn,t.column.sort.compare));};return w("th",e({ref:r,"data-column-id":t.column&&t.column.id,className:et(nt("th"),l()?nt("th","sort"):null,n.fixedHeader?nt("th","fixed"):null,n.className.th),onClick:c,style:e({},n.style.th,{minWidth:t.column.minWidth,width:t.column.width},i,t.style),onKeyDown:function(t){l()&&13===t.which&&c(t);},rowSpan:t.rowSpan>1?t.rowSpan:void 0,colSpan:t.colSpan>1?t.colSpan:void 0},(a=t.column)?"function"==typeof a.attributes?a.attributes(null,null,t.column):a.attributes:{},l()?{tabIndex:0}:{}),w("div",{className:nt("th","content")},void 0!==t.column.name?t.column.name:void 0!==t.column.plugin?w($t,{pluginId:t.column.plugin.id,props:{column:t.column}}):null),l()&&w(bn,e({index:t.index},t.column.sort)),t.column.resizable&&t.index<n.header.visibleColumns.length-1&&w(wn,{column:t.column,thRef:r}))}function kn(){var t,n=Et(),e=jt(function(t){return t.header});return e?w("thead",{key:e.id,className:et(nt("thead"),n.className.thead)},(t=Gt.tabularFormat(e.columns)).map(function(n,r){return function(t,n,r){var o=Gt.leafColumns(e.columns);return w(dn,null,t.map(function(t){return t.hidden?null:function(t,n,e,r){var o=function(t,n,e){var r=Gt.maximumDepth(t),o=e-n;return {rowSpan:Math.floor(o-r-r/o),colSpan:t.columns&&t.columns.length||1}}(t,n,r);return w(xn,{column:t,index:e,colSpan:o.colSpan,rowSpan:o.rowSpan})}(t,n,o.indexOf(t),r)}))}(n,r,t.length)})):null}var Sn=function(t){return function(n){return e({},n,{header:t})}};function Nn(){var t=Et(),n=yt(null),r=Ht().dispatch;return gt(function(){n&&r(function(t){return function(n){return e({},n,{tableRef:t})}}(n));},[n]),w("table",{ref:n,role:"grid",className:et(nt("table"),t.className.table),style:e({},t.style.table,{height:t.height})},w(kn,null),w(_n,null))}function Cn(){var t=vt(!0),n=t[0],r=t[1],o=yt(null),i=Et();return gt(function(){0===o.current.children.length&&r(!1);},[o]),n?w("div",{ref:o,className:et(nt("head"),i.className.header),style:e({},i.style.header)},w($t,{position:qt.Header})):null}function Pn(){var t=yt(null),n=vt(!0),r=n[0],o=n[1],i=Et();return gt(function(){0===t.current.children.length&&o(!1);},[t]),r?w("div",{ref:t,className:et(nt("footer"),i.className.footer),style:e({},i.style.footer)},w($t,{position:qt.Footer})):null}function En(){var t=Et(),n=Ht().dispatch,r=jt(function(t){return t.status}),o=jt(function(t){return t.data}),i=jt(function(t){return t.tableRef}),u={current:null};gt(function(){return n(Sn(t.header)),s(),t.pipeline.on("updated",s),function(){return t.pipeline.off("updated",s)}},[]),gt(function(){t.header&&r===a.Loaded&&null!=o&&o.length&&n(Sn(t.header.adjustWidth(t,i,u)));},[o,t,u]);var s=function(){try{n(function(t){return e({},t,{status:a.Loading})});var r=function(r,o){try{var i=Promise.resolve(t.pipeline.process()).then(function(t){n(function(t){return function(n){return t?e({},n,{data:t,status:a.Loaded}):n}}(t)),setTimeout(function(){n(function(t){return t.status===a.Loaded?e({},t,{status:a.Rendered}):t});},0);});}catch(t){return o(t)}return i&&i.then?i.then(void 0,o):i}(0,function(t){zt.error(t),n(function(t){return e({},t,{data:null,status:a.Error})});});return Promise.resolve(r&&r.then?r.then(function(){}):void 0)}catch(t){return Promise.reject(t)}};return w("div",{role:"complementary",className:et("gridjs",nt("container"),r===a.Loading?nt("loading"):null,t.className.container),style:e({},t.style.container,{width:t.width})},r===a.Loading&&w("div",{className:nt("loading-bar")}),w(Cn,null),w("div",{className:nt("wrapper"),style:{height:t.height}},w(Nn,null)),w(Pn,null),w("div",{ref:u,id:"gridjs-temp",className:nt("temp")}))}var In=/*#__PURE__*/function(t){function n(n){var e;return (e=t.call(this)||this).config=void 0,e.plugin=void 0,e.config=(new fn).assign({instance:i(e),eventEmitter:i(e)}).update(n),e.plugin=e.config.plugin,e}r(n,t);var e=n.prototype;return e.updateConfig=function(t){return this.config.update(t),this},e.createElement=function(){return w(cn.Provider,{value:this.config,children:w(En,{})})},e.forceRender=function(){return this.config&&this.config.container||zt.error("Container is empty. Make sure you call render() before forceRender()",!0),this.destroy(),q(this.createElement(),this.config.container),this},e.destroy=function(){this.config.pipeline.clearCache(),q(null,this.config.container);},e.render=function(t){return t||zt.error("Container element cannot be null",!0),t.childNodes.length>0?(zt.error("The container element "+t+" is not empty. Make sure the container is empty and call render() again"),this):(this.config.container=t,q(this.createElement(),t),this)},n}(Q);//# sourceMappingURL=gridjs.module.js.map

    /* node_modules\gridjs-svelte\gridjs.svelte generated by Svelte v3.55.1 */
    const file = "node_modules\\gridjs-svelte\\gridjs.svelte";

    function create_fragment(ctx) {
    	let article;

    	const block = {
    		c: function create() {
    			article = element("article");
    			add_location(article, file, 74, 0, 1798);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, article, anchor);
    			/*article_binding*/ ctx[18](article);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(article);
    			/*article_binding*/ ctx[18](null);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance_1($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Gridjs', slots, []);
    	let { width = "100%" } = $$props;
    	let { height = "auto" } = $$props;
    	let { autoWidth = true } = $$props;
    	let { fixedHeader = false } = $$props;
    	let { resizable = false } = $$props;
    	let { from = undefined } = $$props;
    	let { language = undefined } = $$props;
    	let { search = false } = $$props;
    	let { sort = false } = $$props;
    	let { pagination = false } = $$props;
    	let { server = undefined } = $$props;
    	let { columns = undefined } = $$props;
    	let { data = undefined } = $$props;
    	let { plugins = undefined } = $$props;
    	let { style = {} } = $$props;
    	let { className = {} } = $$props;

    	const instance = new In({
    			from,
    			data,
    			columns,
    			server,
    			search,
    			sort,
    			pagination,
    			language,
    			width,
    			height,
    			autoWidth,
    			plugins,
    			fixedHeader,
    			resizable,
    			style,
    			className
    		});

    	let node;
    	const dispatch = createEventDispatcher();

    	// https://github.com/grid-js/gridjs/blob/master/src/view/table/events.ts
    	instance.on("cellClick", (...args) => dispatch("cellClick", { ...args }));

    	instance.on("rowClick", (...args) => dispatch("rowClick", { ...args }));

    	// https://github.com/grid-js/gridjs/blob/master/src/view/events.ts
    	instance.on("beforeLoad", () => dispatch("beforeLoad"));

    	instance.on("load", data => dispatch("load", { ...data }));
    	instance.on("ready", () => dispatch("ready"));

    	onMount(() => {
    		if (node) {
    			instance.render(node);
    		}
    	});

    	const writable_props = [
    		'width',
    		'height',
    		'autoWidth',
    		'fixedHeader',
    		'resizable',
    		'from',
    		'language',
    		'search',
    		'sort',
    		'pagination',
    		'server',
    		'columns',
    		'data',
    		'plugins',
    		'style',
    		'className'
    	];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Gridjs> was created with unknown prop '${key}'`);
    	});

    	function article_binding($$value) {
    		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
    			node = $$value;
    			$$invalidate(0, node);
    		});
    	}

    	$$self.$$set = $$props => {
    		if ('width' in $$props) $$invalidate(1, width = $$props.width);
    		if ('height' in $$props) $$invalidate(2, height = $$props.height);
    		if ('autoWidth' in $$props) $$invalidate(3, autoWidth = $$props.autoWidth);
    		if ('fixedHeader' in $$props) $$invalidate(4, fixedHeader = $$props.fixedHeader);
    		if ('resizable' in $$props) $$invalidate(5, resizable = $$props.resizable);
    		if ('from' in $$props) $$invalidate(6, from = $$props.from);
    		if ('language' in $$props) $$invalidate(7, language = $$props.language);
    		if ('search' in $$props) $$invalidate(8, search = $$props.search);
    		if ('sort' in $$props) $$invalidate(9, sort = $$props.sort);
    		if ('pagination' in $$props) $$invalidate(10, pagination = $$props.pagination);
    		if ('server' in $$props) $$invalidate(11, server = $$props.server);
    		if ('columns' in $$props) $$invalidate(12, columns = $$props.columns);
    		if ('data' in $$props) $$invalidate(13, data = $$props.data);
    		if ('plugins' in $$props) $$invalidate(14, plugins = $$props.plugins);
    		if ('style' in $$props) $$invalidate(15, style = $$props.style);
    		if ('className' in $$props) $$invalidate(16, className = $$props.className);
    	};

    	$$self.$capture_state = () => ({
    		onMount,
    		createEventDispatcher,
    		Grid: In,
    		width,
    		height,
    		autoWidth,
    		fixedHeader,
    		resizable,
    		from,
    		language,
    		search,
    		sort,
    		pagination,
    		server,
    		columns,
    		data,
    		plugins,
    		style,
    		className,
    		instance,
    		node,
    		dispatch
    	});

    	$$self.$inject_state = $$props => {
    		if ('width' in $$props) $$invalidate(1, width = $$props.width);
    		if ('height' in $$props) $$invalidate(2, height = $$props.height);
    		if ('autoWidth' in $$props) $$invalidate(3, autoWidth = $$props.autoWidth);
    		if ('fixedHeader' in $$props) $$invalidate(4, fixedHeader = $$props.fixedHeader);
    		if ('resizable' in $$props) $$invalidate(5, resizable = $$props.resizable);
    		if ('from' in $$props) $$invalidate(6, from = $$props.from);
    		if ('language' in $$props) $$invalidate(7, language = $$props.language);
    		if ('search' in $$props) $$invalidate(8, search = $$props.search);
    		if ('sort' in $$props) $$invalidate(9, sort = $$props.sort);
    		if ('pagination' in $$props) $$invalidate(10, pagination = $$props.pagination);
    		if ('server' in $$props) $$invalidate(11, server = $$props.server);
    		if ('columns' in $$props) $$invalidate(12, columns = $$props.columns);
    		if ('data' in $$props) $$invalidate(13, data = $$props.data);
    		if ('plugins' in $$props) $$invalidate(14, plugins = $$props.plugins);
    		if ('style' in $$props) $$invalidate(15, style = $$props.style);
    		if ('className' in $$props) $$invalidate(16, className = $$props.className);
    		if ('node' in $$props) $$invalidate(0, node = $$props.node);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*node, from, data, columns, server, search, sort, pagination, language, width, height, autoWidth, fixedHeader, style, className, resizable*/ 114687) {
    			 if (node) {
    				instance.updateConfig({
    					from,
    					data,
    					columns,
    					server,
    					search,
    					sort,
    					pagination,
    					language,
    					width,
    					height,
    					autoWidth,
    					fixedHeader,
    					style,
    					className,
    					resizable
    				}).forceRender();
    			}
    		}
    	};

    	return [
    		node,
    		width,
    		height,
    		autoWidth,
    		fixedHeader,
    		resizable,
    		from,
    		language,
    		search,
    		sort,
    		pagination,
    		server,
    		columns,
    		data,
    		plugins,
    		style,
    		className,
    		instance,
    		article_binding
    	];
    }

    class Gridjs extends SvelteComponentDev {
    	constructor(options) {
    		super(options);

    		init(this, options, instance_1, create_fragment, safe_not_equal, {
    			width: 1,
    			height: 2,
    			autoWidth: 3,
    			fixedHeader: 4,
    			resizable: 5,
    			from: 6,
    			language: 7,
    			search: 8,
    			sort: 9,
    			pagination: 10,
    			server: 11,
    			columns: 12,
    			data: 13,
    			plugins: 14,
    			style: 15,
    			className: 16,
    			instance: 17
    		});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Gridjs",
    			options,
    			id: create_fragment.name
    		});
    	}

    	get width() {
    		throw new Error("<Gridjs>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set width(value) {
    		throw new Error("<Gridjs>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get height() {
    		throw new Error("<Gridjs>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set height(value) {
    		throw new Error("<Gridjs>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get autoWidth() {
    		throw new Error("<Gridjs>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set autoWidth(value) {
    		throw new Error("<Gridjs>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get fixedHeader() {
    		throw new Error("<Gridjs>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set fixedHeader(value) {
    		throw new Error("<Gridjs>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get resizable() {
    		throw new Error("<Gridjs>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set resizable(value) {
    		throw new Error("<Gridjs>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get from() {
    		throw new Error("<Gridjs>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set from(value) {
    		throw new Error("<Gridjs>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get language() {
    		throw new Error("<Gridjs>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set language(value) {
    		throw new Error("<Gridjs>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get search() {
    		throw new Error("<Gridjs>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set search(value) {
    		throw new Error("<Gridjs>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get sort() {
    		throw new Error("<Gridjs>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set sort(value) {
    		throw new Error("<Gridjs>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get pagination() {
    		throw new Error("<Gridjs>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set pagination(value) {
    		throw new Error("<Gridjs>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get server() {
    		throw new Error("<Gridjs>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set server(value) {
    		throw new Error("<Gridjs>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get columns() {
    		throw new Error("<Gridjs>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set columns(value) {
    		throw new Error("<Gridjs>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get data() {
    		throw new Error("<Gridjs>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set data(value) {
    		throw new Error("<Gridjs>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get plugins() {
    		throw new Error("<Gridjs>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set plugins(value) {
    		throw new Error("<Gridjs>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get style() {
    		throw new Error("<Gridjs>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set style(value) {
    		throw new Error("<Gridjs>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get className() {
    		throw new Error("<Gridjs>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set className(value) {
    		throw new Error("<Gridjs>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get instance() {
    		return this.$$.ctx[17];
    	}

    	set instance(value) {
    		throw new Error("<Gridjs>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    const MTL_EP = "http://43.205.241.105:8080/api/mtl/getAllMoney";
    const MAL_EP = "http://43.205.241.105:8080/api/mal/getAllAssetInvestments";

    let resData;
    let data = [];

    const convertToLowerCase = (obj) => {
        return Object.keys(obj).reduce((acc, key) => {
            acc[key.toLowerCase()] = obj[key];
            return acc;
        }, {});
    };

    const fetchMALData = async () => {
        const responseFromMAL = await fetch(MAL_EP);

        resData = await responseFromMAL.json();

        console.log("resData", resData);
        data = resData.map((data) => {
            return convertToLowerCase(data);
        });

        console.log("TR DA", data);

        return data;
    };

    const fetchMTLData = async () => {
        // api -> use your employee API
        const responseFromMTL = await fetch(MTL_EP);

        resData = await responseFromMTL.json();

        data = resData.map((data) => {
            return convertToLowerCase(data);
        });

        return data;

        // current = "MAL";
    };

    /* App.svelte generated by Svelte v3.55.1 */
    const file$1 = "App.svelte";

    function create_fragment$1(ctx) {
    	let div0;
    	let button0;
    	let t0;
    	let button0_class_value;
    	let t1;
    	let button1;
    	let t2;
    	let button1_class_value;
    	let t3;
    	let div1;
    	let i;
    	let t4;
    	let grid;
    	let current;
    	let mounted;
    	let dispose;

    	grid = new Gridjs({
    			props: {
    				data: /*data*/ ctx[1],
    				search: true,
    				pagination: { enabled: true, limit: 3 }
    			},
    			$$inline: true
    		});

    	const block = {
    		c: function create() {
    			div0 = element("div");
    			button0 = element("button");
    			t0 = text("MTL");
    			t1 = space();
    			button1 = element("button");
    			t2 = text("MAL");
    			t3 = space();
    			div1 = element("div");
    			i = element("i");
    			t4 = space();
    			create_component(grid.$$.fragment);
    			attr_dev(button0, "class", button0_class_value = "" + (null_to_empty(/*current*/ ctx[0] === 'MTL' && 'selected') + " svelte-1lf5b8p"));
    			add_location(button0, file$1, 28, 2, 695);
    			attr_dev(button1, "class", button1_class_value = "" + (null_to_empty(/*current*/ ctx[0] === 'MAL' && 'selected') + " svelte-1lf5b8p"));
    			add_location(button1, file$1, 32, 2, 806);
    			attr_dev(div0, "class", "buttons svelte-1lf5b8p");
    			add_location(div0, file$1, 27, 0, 670);
    			attr_dev(i, "class", "mi mi-undo svelte-1lf5b8p");
    			add_location(i, file$1, 40, 2, 1022);
    			attr_dev(div1, "class", "refresh svelte-1lf5b8p");
    			add_location(div1, file$1, 38, 0, 937);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div0, anchor);
    			append_dev(div0, button0);
    			append_dev(button0, t0);
    			append_dev(div0, t1);
    			append_dev(div0, button1);
    			append_dev(button1, t2);
    			insert_dev(target, t3, anchor);
    			insert_dev(target, div1, anchor);
    			append_dev(div1, i);
    			insert_dev(target, t4, anchor);
    			mount_component(grid, target, anchor);
    			current = true;

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", /*click_handler*/ ctx[3], false, false, false),
    					listen_dev(button1, "click", /*click_handler_1*/ ctx[4], false, false, false),
    					listen_dev(i, "click", click_handler_2, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (!current || dirty & /*current*/ 1 && button0_class_value !== (button0_class_value = "" + (null_to_empty(/*current*/ ctx[0] === 'MTL' && 'selected') + " svelte-1lf5b8p"))) {
    				attr_dev(button0, "class", button0_class_value);
    			}

    			if (!current || dirty & /*current*/ 1 && button1_class_value !== (button1_class_value = "" + (null_to_empty(/*current*/ ctx[0] === 'MAL' && 'selected') + " svelte-1lf5b8p"))) {
    				attr_dev(button1, "class", button1_class_value);
    			}

    			const grid_changes = {};
    			if (dirty & /*data*/ 2) grid_changes.data = /*data*/ ctx[1];
    			grid.$set(grid_changes);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(grid.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(grid.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div0);
    			if (detaching) detach_dev(t3);
    			if (detaching) detach_dev(div1);
    			if (detaching) detach_dev(t4);
    			destroy_component(grid, detaching);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$1.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    const click_handler_2 = () => {
    	
    }; // data = resData;

    function instance($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('App', slots, []);
    	let current = 'MAL';
    	let data = [];

    	const handleClick = async e => {
    		const BTN_NAME = e.target.textContent;

    		// console.log(BTN_NAME === "MAL");
    		if (BTN_NAME === "MAL") {
    			// call MAL FETCH
    			$$invalidate(1, data = await fetchMALData());

    			$$invalidate(0, current = 'MAL');
    		} else {
    			// call MTL FETCH
    			$$invalidate(1, data = await fetchMTLData());

    			$$invalidate(0, current = 'MTL');
    		}
    	};

    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<App> was created with unknown prop '${key}'`);
    	});

    	const click_handler = e => handleClick(e);
    	const click_handler_1 = async e => await handleClick(e);

    	$$self.$capture_state = () => ({
    		onMount,
    		Grid: Gridjs,
    		fetchMALData,
    		fetchMTLData,
    		current,
    		data,
    		handleClick
    	});

    	$$self.$inject_state = $$props => {
    		if ('current' in $$props) $$invalidate(0, current = $$props.current);
    		if ('data' in $$props) $$invalidate(1, data = $$props.data);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [current, data, handleClick, click_handler, click_handler_1];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance, create_fragment$1, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment$1.name
    		});
    	}
    }

    const app = new App({
      target: document.body
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map
