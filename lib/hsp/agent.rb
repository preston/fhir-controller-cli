require 'action_cable_client'

require 'jwt'

module Hsp
    class Agent
        attr_accessor :marketplace
        attr_accessor :orchestrator
        attr_accessor :platform_id
        attr_accessor :platform_secret

        def initialize(marketplace, orchestrator, platform_id, platform_secret)
            self.marketplace = marketplace
            self.orchestrator = orchestrator
			self.platform_id = platform_id
			self.platform_secret = platform_secret
        end

        def run
            EventMachine.run do
				# payload = JWT.encode({foo: :bar}, self.platform_secret)
                uri = marketplace.websocket_url #+ '/' + self.platform_id
 				client = ActionCableClient.new(uri, 'PlatformChannel')
				client.connected do
					puts "Connected to the marketplace at #{uri}."
				end
				client.received do |m|
					puts m
				end
				client.subscribed do
					puts "Successfully subscribed."
				end


            end
              # puts 'This is not yet implemented, and will wait indefinitely.'
          end
    end
end
