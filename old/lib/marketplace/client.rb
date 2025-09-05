module Marketplace
    class Client
        DEFAULT_REST_URL = 'https://marketplace-server.prestonlee.com'.freeze
        DEFAULT_WEBSOCKET_URL = 'wss://marketplace-server.prestonlee.com/websocket'.freeze
        attr_accessor :rest_url
        attr_accessor :websocket_url

        def initialize(rest_url = DEFAULT_REST_URL, websocket_url = DEFAULT_WEBSOCKET_URL)
            self.rest_url = rest_url
            self.websocket_url = websocket_url
        end

        def products_url(id = nil)
            rest_url + '/products' + (id.nil? ? '' : "/#{id}")
        end

        def builds_url(product_id, build_id = nil)
            products_url(product_id) + '/builds' + (build_id.nil? ? '' : "/#{build_id}")
        end

        def users_url(id = nil)
            rest_url + '/users' + (id.nil? ? '' : "/#{id}")
        end

        def platforms_url(user_id, platform_id = nil)
            users_url(user_id) + '/platforms' + (platform_id.nil? ? '' : "/#{platform_id}")
        end
    end
end
