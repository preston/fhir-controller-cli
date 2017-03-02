module Hsp
    class Marketplace
        DEFAULT_REST_URL = 'https://marketplace-server.hspconsortium.org'.freeze
        DEFAULT_WEBSOCKET_URL = 'wss://marketplace-server.hspconsortium.org/websocket'.freeze
        attr_accessor :rest_url
        attr_accessor :websocket_url

        def initialize(rest_url = DEFAULT_REST_URL, websocket_url = DEFAULT_WEBSOCKET_URL)
            self.rest_url = rest_url
            self.websocket_url = websocket_url
        end

        def services_url(id = nil)
            rest_url + '/services' + (id.nil? ? '' : "/#{id}")
        end

        def builds_url(service_id, build_id = nil)
            services_url(service_id) + '/builds' + (build_id.nil? ? '' : "/#{build_id}")
        end

        def users_url(id = nil)
            rest_url + '/users' + (id.nil? ? '' : "/#{id}")
        end

        def platforms_url(user_id, platform_id = nil)
            users_url(user_id) + '/platforms' + (platform_id.nil? ? '' : "/#{platform_id}")
        end
    end
end
