require 'space_elevator'
require 'eventmachine'
require 'em-websocket-client'
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

        def run(platform_id, pings = false)
            EventMachine.run do
                url = marketplace.websocket_url
                client = SpaceElevator::Client.new(url) do
                    puts 'Disconnected. Exiting...'
                    EventMachine.stop_event_loop
                end
                client.connect do |msg|
                    case msg['type']
                    when 'welcome'
                        puts 'The server says "welcome".'
                        client.subscribe(channel: 'ChatChannel') do |chat|
                            puts "Received Chat Event: #{chat}"
                            if chat['type'] == 'confirm_subscription'
                                puts "Subscription to #{chat['identifier']['channel']} confirmed!"
                                client.publish({channel: 'ChatChannel'}, {subject: 'Hi', text: "What's up, y'all!?!?"})
                            end
                        end
                        client.subscribe(channel: 'PlatformChannel', platform_id: platform_id) do |m|
                            puts "Received Platform #{platform_id} Event: #{m}"
                            case m['type']
                            when 'confirm_subscription'
                                # We don't need to dispatch this, I suppose.
                            else
                                self.orchestrator.dispatch(m)
                            end
                        end
                    when 'ping'
                        puts 'The server just pinged us.' if pings
                    else
                        puts msg
                    end
                end
            end
        end
    end
end
